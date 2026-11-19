// FY Voorhoofd: CPU-memory TOP. Krijgt het camerabeeld (liefst verkleind, 8-bit), zoekt op een eigen thread
// het gezicht en geeft via de Info CHOP de plek van het kaartje: x, y (0..1, linksonder), maat (× beeldbreedte),
// hoek (graden), volgt (0 = terugvalplek, 1 = voorhoofd). TD wacht nooit op Vision; nieuwste beeld wint.
// Het beeld zelf geeft de TOP niet door (1×1 doorzichtig).

#include "TOP_CPlusPlusBase.h"
#include "Voorhoofd.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>

using namespace TD;

class GezichtTOP : public TOP_CPlusPlusBase
{
public:
	GezichtTOP(const OP_NodeInfo*, TOP_Context* ctx) : myContext(ctx)
	{
		myStart = std::chrono::steady_clock::now();
		myThread = std::thread([this]() { workerLoop(); });
	}

	virtual ~GezichtTOP()
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
		VoorhoofdParams p;
		p.maat = inputs->getParDouble("Maat");
		p.afstand = inputs->getParDouble("Afstand");
		p.meedraaien = inputs->getParDouble("Meedraaien");
		p.rust = inputs->getParDouble("Rust");
		p.volg = inputs->getParDouble("Volg");
		p.houd = inputs->getParDouble("Houd");
		p.overgang = inputs->getParDouble("Overgang");
		p.terugX = inputs->getParDouble("Terug", 0);
		p.terugY = inputs->getParDouble("Terug", 1);
		p.terugMaat = inputs->getParDouble("Terugmaat");
		p.bevestig = inputs->getParInt("Bevestig");
		bool active = inputs->getParInt("Active") != 0;

		if (active && inputs->getNumInputs() > 0)
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
					if (myPending)
						myDropped++;
					myPending = std::move(dl);
					myPendingParams = p;
					myPendingSince = std::chrono::steady_clock::now();
				}
				myCond.notify_one();
			}
		}
		else
		{
			std::lock_guard<std::mutex> l(myLock);
			myUit = VoorhoofdUit();
			myUit.x = p.terugX;
			myUit.y = p.terugY;
			myUit.maat = p.terugMaat;
			myResetRequested = true;
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

	int32_t getNumInfoCHOPChans(void*) override { return 11; }

	void getInfoCHOPChan(int32_t i, OP_InfoCHOPChan* c, void*) override
	{
		std::lock_guard<std::mutex> l(myLock);
		const char* names[] = {"x", "y", "maat", "hoek", "volgt", "gezicht", "gezichten", "zekerheid",
		                       "vision_ms", "latency_ms", "verwerkt"};
		float vals[] = {(float)myUit.x, (float)myUit.y, (float)myUit.maat, (float)myUit.hoek, (float)myUit.volgt,
		                (float)myUit.gezicht, (float)myUit.gezichten, (float)myUit.zekerheid,
		                (float)myInferMs, (float)myLatencyMs, (float)myProcessed};
		c->name->setString(names[i]);
		c->value = vals[i];
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
		struct F { const char* n; const char* l; double d, lo, hi; };
		F fs[] = {
			{"Maat", "Maat (× gezicht)", 0.95, 0.2, 3},
			{"Afstand", "Afstand boven wenkbrauw (× gezicht)", 0.08, -1, 1},
			{"Meedraaien", "Meedraaien", 1, 0, 1},
			{"Rust", "Rust (lager = rustiger)", 1.0, 0.05, 5},
			{"Volg", "Volgen bij snelle beweging", 0.6, 0, 5},
			{"Houd", "Vasthouden als kwijt (s)", 0.7, 0, 5},
			{"Overgang", "Glijden naar/van terugval (s)", 0.45, 0.05, 3},
			{"Terugmaat", "Terugval maat (× beeldbreedte)", 0.35, 0.05, 1},
		};
		for (auto& f : fs)
		{
			OP_NumericParameter np(f.n);
			np.label = f.l;
			np.defaultValues[0] = f.d;
			np.minSliders[0] = f.lo;
			np.maxSliders[0] = f.hi;
			m->appendFloat(np);
		}
		{
			OP_NumericParameter np("Terug");
			np.label = "Terugval plek (x, y)";
			np.defaultValues[0] = 0.5;
			np.defaultValues[1] = 0.8;
			for (int i = 0; i < 2; i++) { np.minSliders[i] = 0; np.maxSliders[i] = 1; }
			m->appendXY(np);
		}
		{
			OP_NumericParameter np("Bevestig");
			np.label = "Beelden nodig voor sprong";
			np.defaultValues[0] = 3;
			np.minSliders[0] = 1;
			np.maxSliders[0] = 10;
			m->appendInt(np);
		}
		{
			OP_NumericParameter np("Reset");
			np.label = "Reset";
			m->appendPulse(np);
		}
	}

	void pulsePressed(const char* name, void*) override
	{
		if (strcmp(name, "Reset") == 0)
			myResetRequested = true;
	}

private:
	void workerLoop()
	{
		while (true)
		{
			OP_SmartRef<OP_TOPDownloadResult> job;
			VoorhoofdParams p;
			std::chrono::steady_clock::time_point since;
			{
				std::unique_lock<std::mutex> l(myLock);
				myCond.wait(l, [this]() { return myExit || (bool)myPending; });
				if (myExit)
					return;
				job = std::move(myPending);
				myPending = OP_SmartRef<OP_TOPDownloadResult>();
				p = myPendingParams;
				since = myPendingSince;
			}
			if (myResetRequested.exchange(false))
				myVolger.reset();

			const uint8_t* data = (const uint8_t*)job->getData();
			int w = (int)job->textureDesc.width;
			int h = (int)job->textureDesc.height;
			size_t rowBytes = h > 0 ? (size_t)(job->size / h) : 0;
			double t = std::chrono::duration<double>(since - myStart).count();

			auto t0 = std::chrono::steady_clock::now();
			VoorhoofdUit uit;
			std::string err;
			bool ok = data && w > 0 && h > 0 && myVolger.verwerk(data, w, h, rowBytes, t, p, uit, err);
			auto t1 = std::chrono::steady_clock::now();
			job = OP_SmartRef<OP_TOPDownloadResult>();

			std::lock_guard<std::mutex> l(myLock);
			myError = ok ? std::string() : err;
			if (ok)
			{
				myInferMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
				myLatencyMs = std::chrono::duration<double, std::milli>(t1 - since).count();
				myProcessed++;
				myUit = uit;
			}
		}
	}

	TOP_Context* myContext;
	Voorhoofd myVolger;
	std::chrono::steady_clock::time_point myStart;

	std::thread myThread;
	std::mutex myLock;
	std::condition_variable myCond;
	bool myExit = false;
	std::atomic<bool> myResetRequested{false};

	OP_SmartRef<OP_TOPDownloadResult> myPending;
	VoorhoofdParams myPendingParams;
	std::chrono::steady_clock::time_point myPendingSince;

	VoorhoofdUit myUit;
	bool myUploaded = false;
	double myInferMs = 0, myLatencyMs = 0;
	int64_t myProcessed = 0, myDropped = 0;
	std::string myError;
};

extern "C"
{
DLLEXPORT void FillTOPPluginInfo(TOP_PluginInfo* info)
{
	info->apiVersion = TOPCPlusPlusAPIVersion;
	info->executeMode = TOP_ExecuteMode::CPUMem;
	info->customOPInfo.opType->setString("Fyvoorhoofd");
	info->customOPInfo.opLabel->setString("FY Voorhoofd");
	info->customOPInfo.opIcon->setString("FYV");
	info->customOPInfo.authorName->setString("For_You");
	info->customOPInfo.authorEmail->setString("");
	info->customOPInfo.minInputs = 1;
	info->customOPInfo.maxInputs = 1;
}

DLLEXPORT TOP_CPlusPlusBase* CreateTOPInstance(const OP_NodeInfo* info, TOP_Context* context)
{
	return new GezichtTOP(info, context);
}

DLLEXPORT void DestroyTOPInstance(TOP_CPlusPlusBase* instance, TOP_Context*)
{
	delete (GezichtTOP*)instance;
}
}
