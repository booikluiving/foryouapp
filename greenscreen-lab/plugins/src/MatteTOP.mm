// CPU-memory TOP die een camerabeeld naar een engine stuurt en de matte teruggeeft.
// Het rekenwerk loopt op een eigen thread: TD wacht nooit op de inferentie.
// Nieuwste frame wint; frames die binnenkomen terwijl de engine bezig is, worden overgeslagen.

#include "TOP_CPlusPlusBase.h"
#include "Engine.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <thread>

using namespace TD;

class MatteTOP : public TOP_CPlusPlusBase
{
public:
	MatteTOP(const OP_NodeInfo* info, TOP_Context* ctx) : myContext(ctx)
	{
		myEngine = createEngine();
		myThread = std::thread([this]() { workerLoop(); });
	}

	virtual ~MatteTOP()
	{
		{
			std::lock_guard<std::mutex> l(myLock);
			myExit = true;
		}
		myCond.notify_all();
		if (myThread.joinable())
			myThread.join();
		delete myEngine;
	}

	void getGeneralInfo(TOP_GeneralInfo* g, const OP_Inputs*, void*) override
	{
		g->cookEveryFrame = true;
	}

	void execute(TOP_Output* output, const OP_Inputs* inputs, void*) override
	{
		EngineParams p;
		p.quality = inputs->getParInt("Quality");
		p.output = inputs->getParInt("Output");
		const char* mp = inputs->getParFilePath("Model");
		p.modelPath = mp ? mp : "";
		bool active = inputs->getParInt("Active") != 0;
		if (engineHasKeyParams())
		{
			p.ai = inputs->getParInt("Ai");
			p.garbage = inputs->getParInt("Garbage") != 0;
			p.keyLow = inputs->getParDouble("Keylow");
			p.keyHigh = inputs->getParDouble("Keyhigh");
			p.despill = inputs->getParDouble("Despill");
			p.aiFill = inputs->getParDouble("Aifill");
			p.adapt = inputs->getParDouble("Adapt");
			p.tint = inputs->getParDouble("Tint");
			p.clean = inputs->getParDouble("Clean");
			p.cropL = inputs->getParDouble("Randlinks");
			p.cropR = inputs->getParDouble("Randrechts");
			p.cropT = inputs->getParDouble("Randboven");
			p.cropB = inputs->getParDouble("Randonder");
		}

		if (active && inputs->getNumInputs() > 0)
		{
			const OP_TOPInput* top = inputs->getInputTOP(0);
			if (top)
			{
				OP_TOPInputDownloadOptions opts;
				opts.pixelFormat = OP_PixelFormat::BGRA8Fixed;
				opts.verticalFlip = true;  // top-down voor Vision/CoreML
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

		EngineResult res;
		bool have = false;
		{
			std::lock_guard<std::mutex> l(myLock);
			if (myResultReady)
			{
				res.bgra.swap(myResult.bgra);
				res.width = myResult.width;
				res.height = myResult.height;
				myResultReady = false;
				have = true;
			}
		}
		if (have && res.width > 0)
		{
			TOP_UploadInfo info;
			info.textureDesc.width = res.width;
			info.textureDesc.height = res.height;
			info.textureDesc.texDim = OP_TexDim::e2D;
			info.textureDesc.pixelFormat = OP_PixelFormat::BGRA8Fixed;
			info.firstPixel = TOP_FirstPixel::TopLeft;
			OP_SmartRef<TOP_Buffer> buf = myContext->createOutputBuffer(res.bgra.size(), TOP_BufferFlags::None, nullptr);
			memcpy(buf->data, res.bgra.data(), res.bgra.size());
			output->uploadBuffer(&buf, info, nullptr);
			myUploaded++;
		}
	}

	int32_t getNumInfoCHOPChans(void*) override { return 5; }

	void getInfoCHOPChan(int32_t i, OP_InfoCHOPChan* c, void*) override
	{
		std::lock_guard<std::mutex> l(myLock);
		const char* names[] = {"infer_ms", "latency_ms", "processed", "dropped", "uploaded"};
		float vals[] = {(float)myInferMs, (float)myLatencyMs, (float)myProcessed, (float)myDropped, (float)myUploaded};
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
			np.label = "Active";
			np.defaultValues[0] = 1;
			m->appendToggle(np);
		}
		{
			OP_StringParameter sp("Output");
			sp.label = "Output";
			sp.defaultValue = "Cutout";
			const char* names[] = {"Cutout", "Matte", "Debug"};
			const char* labels[] = {"Cutout (premultiplied)", "Matte", "Debug (key/AI/papier)"};
			m->appendMenu(sp, engineHasKeyParams() ? 3 : 2, names, labels);
		}
		{
			OP_StringParameter sp("Quality");
			sp.label = "Quality (Vision)";
			sp.defaultValue = "Balanced";
			const char* names[] = {"Fast", "Balanced", "Accurate"};
			const char* labels[] = {"Fast", "Balanced", "Accurate"};
			m->appendMenu(sp, 3, names, labels);
		}
		{
			OP_StringParameter sp("Model");
			sp.label = "Model (RVM .mlpackage)";
			sp.defaultValue = "";
			m->appendFile(sp);
		}
		if (engineHasKeyParams())
		{
			{
				OP_StringParameter sp("Ai");
				sp.label = "AI-hulp";
				sp.page = "Key";
				sp.defaultValue = "None";
				const char* names[] = {"None", "Vision", "Rvm"};
				const char* labels[] = {"Geen", "Apple Vision", "RVM"};
				m->appendMenu(sp, 3, names, labels);
			}
			{
				OP_NumericParameter np("Garbage");
				np.label = "Randmasker";
				np.page = "Key";
				np.defaultValues[0] = 0;
				m->appendToggle(np);
			}
			struct F { const char* n; const char* l; double d; };
			F fs[] = {{"Keylow", "Key onder (voorgrond)", 0.25}, {"Keyhigh", "Key boven (papier)", 0.70},
			          {"Despill", "Despill", 0.8}, {"Aifill", "AI vult vanaf", 0.85}, {"Adapt", "Kalibratie-snelheid", 0.15},
			          {"Tint", "Tint-tolerantie", 0.06}, {"Clean", "Gaatjes dichten", 0.5},
			          {"Randlinks", "Rand links", 0}, {"Randrechts", "Rand rechts", 0}, {"Randboven", "Rand boven", 0}, {"Randonder", "Rand onder", 0}};
			for (auto& f : fs)
			{
				OP_NumericParameter np(f.n);
				np.label = f.l;
				np.page = "Key";
				np.defaultValues[0] = f.d;
				np.minSliders[0] = 0;
				np.maxSliders[0] = 1;
				np.minValues[0] = 0;
				np.maxValues[0] = 1;
				np.clampMins[0] = np.clampMaxes[0] = true;
				m->appendFloat(np);
			}
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
			EngineParams p;
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
				myEngine->reset();

			const uint8_t* data = (const uint8_t*)job->getData();
			int w = (int)job->textureDesc.width;
			int h = (int)job->textureDesc.height;
			size_t rowBytes = h > 0 ? (size_t)(job->size / h) : 0;

			auto t0 = std::chrono::steady_clock::now();
			EngineResult out;
			std::string err;
			bool ok = data && w > 0 && h > 0 && myEngine->process(data, w, h, rowBytes, p, out, err);
			auto t1 = std::chrono::steady_clock::now();
			job = OP_SmartRef<OP_TOPDownloadResult>();

			std::lock_guard<std::mutex> l(myLock);
			myError = ok ? std::string() : err;
			if (ok)
			{
				myInferMs = std::chrono::duration<double, std::milli>(t1 - t0).count();
				myLatencyMs = std::chrono::duration<double, std::milli>(t1 - since).count();
				myProcessed++;
				myResult.bgra.swap(out.bgra);
				myResult.width = out.width;
				myResult.height = out.height;
				myResultReady = true;
			}
		}
	}

	TOP_Context* myContext;
	Engine* myEngine = nullptr;

	std::thread myThread;
	std::mutex myLock;
	std::condition_variable myCond;
	bool myExit = false;
	std::atomic<bool> myResetRequested{false};

	OP_SmartRef<OP_TOPDownloadResult> myPending;
	EngineParams myPendingParams;
	std::chrono::steady_clock::time_point myPendingSince;

	EngineResult myResult;
	bool myResultReady = false;

	double myInferMs = 0, myLatencyMs = 0;
	int64_t myProcessed = 0, myDropped = 0, myUploaded = 0;
	std::string myError;
};

extern "C"
{
DLLEXPORT void FillTOPPluginInfo(TOP_PluginInfo* info)
{
	info->apiVersion = TOPCPlusPlusAPIVersion;
	info->executeMode = TOP_ExecuteMode::CPUMem;
	info->customOPInfo.opType->setString(engineOpType());
	info->customOPInfo.opLabel->setString(engineOpLabel());
	info->customOPInfo.opIcon->setString(engineOpIcon());
	info->customOPInfo.authorName->setString("For_You greenscreen-lab");
	info->customOPInfo.authorEmail->setString("");
	info->customOPInfo.minInputs = 1;
	info->customOPInfo.maxInputs = 1;
}

DLLEXPORT TOP_CPlusPlusBase* CreateTOPInstance(const OP_NodeInfo* info, TOP_Context* context)
{
	return new MatteTOP(info, context);
}

DLLEXPORT void DestroyTOPInstance(TOP_CPlusPlusBase* instance, TOP_Context*)
{
	delete (MatteTOP*)instance;
}
}
