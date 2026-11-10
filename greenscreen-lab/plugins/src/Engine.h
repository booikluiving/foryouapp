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
