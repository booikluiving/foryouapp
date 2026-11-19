// Bron (BGRA) + alfa (8 bit) -> uitvoer: cutout (voorvermenigvuldigd) of matte (grijs).
#pragma once
#include <cstdint>
#include <cstring>
#include "Engine.h"

inline void composeBGRA(const uint8_t* in, size_t rowBytes, const uint8_t* alpha, int w, int h,
                        int mode, EngineResult& out)
{
	out.width = w;
	out.height = h;
	out.bgra.resize((size_t)w * h * 4);
	uint8_t* o = out.bgra.data();
	for (int y = 0; y < h; ++y)
	{
		const uint8_t* s = in + (size_t)y * rowBytes;
		const uint8_t* a = alpha + (size_t)y * w;
		uint8_t* d = o + (size_t)y * w * 4;
		if (mode == 1)
		{
			for (int x = 0; x < w; ++x)
			{
				d[4 * x + 0] = d[4 * x + 1] = d[4 * x + 2] = a[x];
				d[4 * x + 3] = 255;
			}
		}
		else
		{
			for (int x = 0; x < w; ++x)
			{
				unsigned av = a[x];
				d[4 * x + 0] = (uint8_t)((s[4 * x + 0] * av + 127) / 255);
				d[4 * x + 1] = (uint8_t)((s[4 * x + 1] * av + 127) / 255);
				d[4 * x + 2] = (uint8_t)((s[4 * x + 2] * av + 127) / 255);
				d[4 * x + 3] = (uint8_t)av;
			}
		}
	}
}
