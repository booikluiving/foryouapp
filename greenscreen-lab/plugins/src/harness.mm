// Test buiten TD: leest ruwe BGRA-frames van stdin, draait de engine, schrijft het laatste resultaat.
// ffmpeg -i clip -f rawvideo -pix_fmt bgra - | harness W H out.bgra [quality] [output] [model]
#include "Engine.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <algorithm>

int main(int argc, char** argv)
{
	if (argc < 4) { fprintf(stderr, "gebruik: harness W H out.bgra [quality] [output] [model]\n"); return 2; }
	int w = atoi(argv[1]), h = atoi(argv[2]);
	EngineParams p;
	if (argc > 4) p.quality = atoi(argv[4]);
	if (argc > 5) p.output = atoi(argv[5]);
	if (argc > 6) p.modelPath = argv[6];
	Engine* e = createEngine();
	std::vector<uint8_t> frame((size_t)w * h * 4);
	std::vector<double> ms;
	EngineResult r;
	while (fread(frame.data(), 1, frame.size(), stdin) == frame.size())
	{
		std::string err;
		auto t0 = std::chrono::steady_clock::now();
		if (!e->process(frame.data(), w, h, (size_t)w * 4, p, r, err)) { fprintf(stderr, "fout: %s\n", err.c_str()); return 1; }
		ms.push_back(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
	}
	FILE* f = fopen(argv[3], "wb");
	fwrite(r.bgra.data(), 1, r.bgra.size(), f);
	fclose(f);
	std::vector<double> s(ms.begin() + std::min<size_t>(5, ms.size()), ms.end());
	std::sort(s.begin(), s.end());
	if (!s.empty())
		printf("%zu frames, uit %dx%d, mediaan %.1f ms, p95 %.1f ms, eerste %.0f ms\n", ms.size(), r.width, r.height,
		       s[s.size() / 2], s[(size_t)(s.size() * 0.95)], ms[0]);
	delete e;
	return 0;
}
