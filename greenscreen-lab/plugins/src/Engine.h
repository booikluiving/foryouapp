// Gemeenschappelijke interface voor de matte-engines (Apple Vision, RVM/CoreML).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct EngineParams
{
	int quality = 1;        // Vision: 0 fast, 1 balanced, 2 accurate
	int output = 0;         // 0 cutout (voorvermenigvuldigd RGBA), 1 matte (grijs)
	std::string modelPath;  // RVM: pad naar .mlpackage / .mlmodel
	// auto-key
	int ai = 0;             // 0 geen, 1 Vision, 2 RVM
	bool garbage = false;   // randmasker aan
	double cropL = 0, cropR = 0, cropT = 0, cropB = 0;  // randmasker, fractie van het beeld
	double keyLow = 0.25;   // onder deze verhouding: volledig voorgrond
	double keyHigh = 0.70;  // boven deze verhouding: volledig papier
	double despill = 0.8;
	double aiFill = 0.85;   // AI-zekerheid vanaf waar gaten gevuld worden
	double adapt = 0.15;
	double tint = 0.06;     // tolerantie rond de papiertint (chromaticiteit)
	double clean = 0.5;     // gaatjes dichten (0 uit, 1 grof)    // hoe snel de kalibratie meebeweegt (per frame)
};

struct EngineResult
{
	std::vector<uint8_t> bgra;  // top-down, BGRA8
	int width = 0;
	int height = 0;
};

class Engine
{
public:
	virtual ~Engine() {}
	// in: BGRA8, top-down, rowBytes per rij. Draait op de worker-thread.
	virtual bool process(const uint8_t* in, int w, int h, size_t rowBytes,
	                     const EngineParams& p, EngineResult& out, std::string& err) = 0;
	virtual void reset() {}
};

Engine* createEngine();
const char* engineOpType();
const char* engineOpLabel();
const char* engineOpIcon();
bool engineHasKeyParams();
