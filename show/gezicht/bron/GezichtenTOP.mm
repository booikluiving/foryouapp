// FY Gezichten: CPU-memory TOP voor de ondertitel. Kijkt een paar keer per seconde (parameter Interval) naar
// het beeld, zoekt op een eigen thread de gezichten met Apple Vision (alleen kaders, geen gelaatstrekken:
// licht) en geeft via de Info CHOP het aantal en tot 4 kaders: x, y, b, h (0..1, oorsprong LINKSBOVEN, zoals
// de webpagina rekent). TD wacht nooit op Vision; nieuwste beeld wint. Het beeld zelf geeft de TOP niet door.

#include "TOP_CPlusPlusBase.h"

#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace TD;

namespace {
const int MAX_GEZICHTEN = 4;
struct Kader { float x = 0, y = 0, b = 0, h = 0; };
}

class GezichtenTOP : public TOP_CPlusPlusBase
{
public:
	GezichtenTOP(const OP_NodeInfo*, TOP_Context* ctx) : myContext(ctx)
	{
		myReq = [[VNDetectFaceRectanglesRequest alloc] init];
		myLaatste = std::chrono::steady_clock::now() - std::chrono::seconds(10);
		myThread = std::thread([this]() { workerLoop(); });
	}

	virtual ~GezichtenTOP()
	{
		{
			std::lock_guard<std::mutex> l(myLock);
			myExit = true;
		}
		myCond.notify_all();
		if (myThread.joinable())
			myThread.join();
	}

	void getGeneralInfo(TOP_GeneralInfo* g, const OP_Inputs*, void*) override
	{
		g->cookEveryFrame = true;
	}

	void execute(TOP_Output* output, const OP_Inputs* inputs, void*) override
	{
		bool active = inputs->getParInt("Active") != 0;
		double interval = std::max(0.05, inputs->getParDouble("Interval"));
		myMinBreedte = inputs->getParDouble("Minbreedte");
		auto nu = std::chrono::steady_clock::now();
		// Alleen om de Interval een beeld ophalen: het kopiëren uit de GPU kost ook iets.
		if (active && inputs->getNumInputs() > 0 && std::chrono::duration<double>(nu - myLaatste).count() >= interval)
		{
			const OP_TOPInput* top = inputs->getInputTOP(0);
			if (top)
			{
				OP_TOPInputDownloadOptions opts;
				opts.pixelFormat = OP_PixelFormat::BGRA8Fixed;
				opts.verticalFlip = true;  // bovenste rij eerst, zoals Vision verwacht
				OP_SmartRef<OP_TOPDownloadResult> dl = top->downloadTexture(opts, nullptr);
				if (dl)
				{
					std::lock_guard<std::mutex> l(myLock);
					myPending = std::move(dl);
					myLaatste = nu;
				}
				myCond.notify_one();
			}
		}
		if (!active)
		{
			std::lock_guard<std::mutex> l(myLock);
			myKaders.clear();
		}
		if (!myUploaded)
		{
			TOP_UploadInfo info;
			info.textureDesc.width = 1;
			info.textureDesc.height = 1;
			info.textureDesc.texDim = OP_TexDim::e2D;
			info.textureDesc.pixelFormat = OP_PixelFormat::BGRA8Fixed;
			info.firstPixel = TOP_FirstPixel::TopLeft;
			OP_SmartRef<TOP_Buffer> buf = myContext->createOutputBuffer(4, TOP_BufferFlags::None, nullptr);
			memset(buf->data, 0, 4);
			output->uploadBuffer(&buf, info, nullptr);
			myUploaded = true;
		}
	}

	int32_t getNumInfoCHOPChans(void*) override { return 4 + MAX_GEZICHTEN * 4; }

	void getInfoCHOPChan(int32_t i, OP_InfoCHOPChan* c, void*) override
	{
		std::lock_guard<std::mutex> l(myLock);
		static const char* vast[] = {"aantal", "vision_ms", "verwerkt", "leeftijd_s"};
		if (i < 4)
		{
			double leeftijd = std::chrono::duration<double>(std::chrono::steady_clock::now() - myGemeten).count();
			float vals[] = {(float)myKaders.size(), (float)myInferMs, (float)myProcessed, (float)leeftijd};
			c->name->setString(vast[i]);
			c->value = vals[i];
			return;
		}
		int k = (i - 4) / 4, deel = (i - 4) % 4;
		static const char* delen[] = {"x", "y", "b", "h"};
		std::string naam = std::string(delen[deel]) + std::to_string(k + 1);
		c->name->setString(naam.c_str());
		float v = 0;
		if (k < (int)myKaders.size())
		{
			const Kader& kd = myKaders[k];
			v = deel == 0 ? kd.x : deel == 1 ? kd.y : deel == 2 ? kd.b : kd.h;
		}
		c->value = v;
	}

	void getErrorString(OP_String* error, void*) override
	{
		std::lock_guard<std::mutex> l(myLock);
		if (!myError.empty())
			error->setString(myError.c_str());
	}

	void setupParameters(OP_ParameterManager* m, void*) override
	{
		{
			OP_NumericParameter np("Active");
			np.label = "Aan";
			np.defaultValues[0] = 1;
			m->appendToggle(np);
		}
		{
			OP_NumericParameter np("Interval");
			np.label = "Interval (s)";
			np.defaultValues[0] = 0.2;
			np.minSliders[0] = 0.05;
			np.maxSliders[0] = 2;
			m->appendFloat(np);
		}
		{
			OP_NumericParameter np("Minbreedte");
			np.label = "Kleinste gezicht (× beeldbreedte)";
			np.defaultValues[0] = 0.04;
			np.minSliders[0] = 0;
			np.maxSliders[0] = 0.5;
			m->appendFloat(np);
		}
	}

private:
	void workerLoop()
	{
		while (true)
		{
			OP_SmartRef<OP_TOPDownloadResult> job;
			{
				std::unique_lock<std::mutex> l(myLock);
				myCond.wait(l, [this]() { return myExit || (bool)myPending; });
				if (myExit)
					return;
				job = std::move(myPending);
				myPending = OP_SmartRef<OP_TOPDownloadResult>();
			}
			const uint8_t* data = (const uint8_t*)job->getData();
			int w = (int)job->textureDesc.width;
			int h = (int)job->textureDesc.height;
			size_t rowBytes = h > 0 ? (size_t)(job->size / h) : 0;
			std::vector<Kader> kaders;
			std::string err;
			auto t0 = std::chrono::steady_clock::now();
			if (data && w > 0 && h > 0)
			{
				@autoreleasepool
				{
					CVPixelBufferRef pb = nullptr;
					CVReturn cr = CVPixelBufferCreateWithBytes(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA,
						(void*)data, rowBytes, nullptr, nullptr, nullptr, &pb);
					if (cr != kCVReturnSuccess || !pb)
						err = "CVPixelBufferCreateWithBytes mislukt";
					else
					{
						VNImageRequestHandler* hd = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pb options:@{}];
						NSError* e = nil;
						BOOL ok = [hd performRequests:@[myReq] error:&e];
						CVPixelBufferRelease(pb);
						if (!ok)
							err = std::string("Vision: ") + (e ? e.localizedDescription.UTF8String : "fout");
						else
						{
							for (VNFaceObservation* f in myReq.results)
							{
								CGRect r = f.boundingBox;  // genormaliseerd, oorsprong linksonder
								if (r.size.width < myMinBreedte)
									continue;
								Kader kd;
								kd.x = (float)r.origin.x;
								kd.y = (float)(1.0 - r.origin.y - r.size.height);  // naar linksboven
								kd.b = (float)r.size.width;
								kd.h = (float)r.size.height;
								kaders.push_back(kd);
							}
							// grootste eerst, hooguit 4
							std::sort(kaders.begin(), kaders.end(), [](const Kader& a, const Kader& b) { return a.b * a.h > b.b * b.h; });
							if ((int)kaders.size() > MAX_GEZICHTEN)
								kaders.resize(MAX_GEZICHTEN);
						}
					}
				}
			}
			auto t1 = std::chrono::steady_clock::now();
			job = OP_SmartRef<OP_TOPDownloadResult>();
			std::lock_guard<std::mutex> l(myLock);
			myError = err;
			if (err.empty())
			{
				myKaders = kaders;
				myInferMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
				myProcessed++;
				myGemeten = t1;
			}
		}
	}

	TOP_Context* myContext;
	VNDetectFaceRectanglesRequest* myReq = nil;
	std::thread myThread;
	std::mutex myLock;
	std::condition_variable myCond;
	bool myExit = false;
	OP_SmartRef<OP_TOPDownloadResult> myPending;
	std::chrono::steady_clock::time_point myLaatste;
	std::chrono::steady_clock::time_point myGemeten;
	std::vector<Kader> myKaders;
	double myMinBreedte = 0.04;
	bool myUploaded = false;
	double myInferMs = 0;
	int64_t myProcessed = 0;
	std::string myError;
};

extern "C"
{
DLLEXPORT void FillTOPPluginInfo(TOP_PluginInfo* info)
{
	info->apiVersion = TOPCPlusPlusAPIVersion;
	info->executeMode = TOP_ExecuteMode::CPUMem;
	info->customOPInfo.opType->setString("Fygezichten");
	info->customOPInfo.opLabel->setString("FY Gezichten");
	info->customOPInfo.opIcon->setString("FYG");
	info->customOPInfo.authorName->setString("For_You");
	info->customOPInfo.authorEmail->setString("");
	info->customOPInfo.minInputs = 1;
	info->customOPInfo.maxInputs = 1;
}

DLLEXPORT TOP_CPlusPlusBase* CreateTOPInstance(const OP_NodeInfo* info, TOP_Context* context)
{
	return new GezichtenTOP(info, context);
}

DLLEXPORT void DestroyTOPInstance(TOP_CPlusPlusBase* instance, TOP_Context*)
{
	delete (GezichtenTOP*)instance;
}
}
