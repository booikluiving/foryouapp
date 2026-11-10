// Auto-key voor het blauwe papier, optioneel gecombineerd met een AI-matte (Vision of RVM) op hetzelfde frame.
//
// 1. Kalibratie per frame (laag-resolutie, in de tijd gedempt):
//    - zoek het grootste blauwe vlak: piek in een histogram van de chromaticiteit (r,g)/(r+g+b) van blauwe pixels;
//    - meet per vak van 32x32 px hoe "blauw" het papier daar is (B - max(R,G)), vul vakken zonder papier
//      aan vanuit de buren. Zo werkt de key ook bij ongelijk licht en een andere blauwtint.
// 2. Key per pixel: verhouding van het eigen blauw-verschil tot dat van het papier op die plek.
// 3. Despill: blauwe zweem uit de voorgrond (B begrensd tot max(R,G) + rest).
// 4. Randmasker (instelbaar per camera): binnen het kader de key; daarbuiten alleen wat de AI als mens ziet.
// 5. AI-vulling: waar de AI zeker is van een mens, vult hij gaten in de key (blauwe kleding, blauw tegenlicht).
//    Randen en voorwerpen blijven van de key.

#import <Foundation/Foundation.h>
#include <Accelerate/Accelerate.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>
#include "Engine.h"

Engine* createVisionEngine();
Engine* createRvmEngine();

static inline float sstep(float a, float b, float x)
{
	float t = (x - a) / (b - a);
	t = t < 0.f ? 0.f : (t > 1.f ? 1.f : t);
	return t * t * (3.f - 2.f * t);
}

class KeyEngine : public Engine
{
public:
	~KeyEngine() override
	{
		delete myVision;
		delete myRvm;
	}

	void reset() override
	{
		myCells.clear();
		if (myRvm) myRvm->reset();
		if (myVision) myVision->reset();
	}

	bool process(const uint8_t* in, int w, int h, size_t rowBytes,
	             const EngineParams& p, EngineResult& out, std::string& err) override
	{
		calibrate(in, w, h, rowBytes, p);

		// AI-matte op hetzelfde frame
		const uint8_t* ai = nullptr;
		if (p.ai == 1 || p.ai == 2)
		{
			Engine*& e = p.ai == 1 ? myVision : myRvm;
			if (!e) e = p.ai == 1 ? createVisionEngine() : createRvmEngine();
			EngineParams ap = p;
			ap.output = 1;
			if (!e->process(in, w, h, rowBytes, ap, myAiOut, err))
				return false;
			myAi.resize((size_t)w * h);
			if (myAiOut.width == w && myAiOut.height == h)
			{
				for (size_t i = 0; i < myAi.size(); ++i) myAi[i] = myAiOut.bgra[i * 4];
			}
			else
			{
				std::vector<uint8_t> small((size_t)myAiOut.width * myAiOut.height);
				for (size_t i = 0; i < small.size(); ++i) small[i] = myAiOut.bgra[i * 4];
				vImage_Buffer s = {small.data(), (vImagePixelCount)myAiOut.height, (vImagePixelCount)myAiOut.width, (size_t)myAiOut.width};
				vImage_Buffer d = {myAi.data(), (vImagePixelCount)h, (vImagePixelCount)w, (size_t)w};
				vImageScale_Planar8(&s, &d, nullptr, kvImageNoFlags);
			}
			ai = myAi.data();
		}

		out.width = w;
		out.height = h;
		out.bgra.resize((size_t)w * h * 4);
		const float lo = (float)p.keyLow, hi = (float)p.keyHigh, spill = (float)p.despill;
		const float fillLo = (float)p.aiFill, fillHi = std::min(1.f, fillLo + 0.1f);
		const float tolC = std::max(0.005f, (float)p.tint);
		const int mode = p.output;

		// pas 1: key-alfa. Papier = blauwer dan het papier hier gemiddeld is (verhouding) EN dezelfde tint als het papier.
		myKey.resize((size_t)w * h);
		for (int y = 0; y < h; ++y)
		{
			const uint8_t* s = in + (size_t)y * rowBytes;
			uint8_t* k = myKey.data() + (size_t)y * w;
			float cy = (y + 0.5f) / myCell - 0.5f;
			for (int x = 0; x < w; ++x)
			{
				float b = s[4 * x] / 255.f, g = s[4 * x + 1] / 255.f, r = s[4 * x + 2] / 255.f;
				float cx = (x + 0.5f) / myCell - 0.5f;
				float bgLevel = sampleCells(cx, cy, myCells);
				float ratio = (b - std::max(r, g)) / std::max(bgLevel, 0.02f);
				float sum = r + g + b;
				float tint = 0.f;
				if (sum > 0.04f)
				{
					float dr = r / sum - myPr, dg = g / sum - myPg;
					tint = 1.f - sstep(tolC, 2.5f * tolC, std::sqrt(dr * dr + dg * dg));
				}
				float bg = sstep(lo, hi, ratio) * tint;
				k[x] = (uint8_t)((1.f - bg) * 255.f + 0.5f);
			}
		}
		// opschonen: kleine gaatjes in de voorgrond dichten (sluiten), daarna licht verzachten
		int ks = 1 + 2 * (int)std::lround(std::max(0.0, std::min(1.0, p.clean)) * 4.0);
		if (ks > 1)
		{
			myTmp.resize(myKey.size());
			vImage_Buffer kb = {myKey.data(), (vImagePixelCount)h, (vImagePixelCount)w, (size_t)w};
			vImage_Buffer tb = {myTmp.data(), (vImagePixelCount)h, (vImagePixelCount)w, (size_t)w};
			vImageMax_Planar8(&kb, &tb, nullptr, 0, 0, ks, ks, kvImageEdgeExtend);
			vImageMin_Planar8(&tb, &kb, nullptr, 0, 0, ks, ks, kvImageEdgeExtend);
			vImageTentConvolve_Planar8(&kb, &tb, nullptr, 0, 0, 3, 3, 0, kvImageEdgeExtend);
			myKey.swap(myTmp);
		}

		// pas 2: combineren met AI en randmasker, uitvoer
		for (int y = 0; y < h; ++y)
		{
			const uint8_t* s = in + (size_t)y * rowBytes;
			const uint8_t* k = myKey.data() + (size_t)y * w;
			uint8_t* d = out.bgra.data() + (size_t)y * w * 4;
			for (int x = 0; x < w; ++x)
			{
				float b = s[4 * x] / 255.f, g = s[4 * x + 1] / 255.f, r = s[4 * x + 2] / 255.f;
				float inPaper = 1.f;
				if (p.garbage)
				{
					float u = (x + 0.5f) / w, v = (y + 0.5f) / h, f = 0.01f;
					inPaper = sstep((float)p.cropL - f, (float)p.cropL + f, u) * (1.f - sstep(1.f - (float)p.cropR - f, 1.f - (float)p.cropR + f, u)) *
					          sstep((float)p.cropT - f, (float)p.cropT + f, v) * (1.f - sstep(1.f - (float)p.cropB - f, 1.f - (float)p.cropB + f, v));
				}
				float aKey = k[x] / 255.f;
				float aAi = ai ? ai[(size_t)y * w + x] / 255.f : 0.f;
				float aIn = aKey;
				if (ai) aIn = std::max(aKey, sstep(fillLo, fillHi, aAi));  // gaten in de mens vullen
				float aOut = ai ? aAi : 0.f;                                  // buiten het kader: alleen de mens
				float a = aIn * inPaper + aOut * (1.f - inPaper);

				if (mode == 2)
				{
					// debug: blauw = key, groen = door AI toegevoegd, rood = weggehaald door het randmasker
					float added = std::max(0.f, a - aKey * inPaper);
					float removed = std::max(0.f, aKey - a);
					d[4 * x + 0] = (uint8_t)(255.f * std::min(1.f, aKey * inPaper) * 0.8f);
					d[4 * x + 1] = (uint8_t)(255.f * std::min(1.f, added));
					d[4 * x + 2] = (uint8_t)(255.f * std::min(1.f, removed));
					d[4 * x + 3] = 255;
					continue;
				}
				if (mode == 1)
				{
					uint8_t v = (uint8_t)(a * 255.f + 0.5f);
					d[4 * x] = d[4 * x + 1] = d[4 * x + 2] = v;
					d[4 * x + 3] = 255;
					continue;
				}
				// despill: blauw niet hoger dan max(R,G), naar mate van 'spill'
				float lim = std::max(r, g);
				if (b > lim) b = b - spill * (b - lim);
				d[4 * x + 0] = (uint8_t)(b * a * 255.f + 0.5f);
				d[4 * x + 1] = (uint8_t)(g * a * 255.f + 0.5f);
				d[4 * x + 2] = (uint8_t)(r * a * 255.f + 0.5f);
				d[4 * x + 3] = (uint8_t)(a * 255.f + 0.5f);
			}
		}
		return true;
	}

	// Voor de Info CHOP / log: gevonden papierkleur
	float paperR = 0, paperG = 0, paperB = 0;

protected:
	int myCell = 32;

	float sampleCells(float cx, float cy, const std::vector<float>& cells) const
	{
		if (cells.empty()) return 0.f;
		cx = std::max(0.f, std::min(cx, (float)(myGW - 1)));
		cy = std::max(0.f, std::min(cy, (float)(myGH - 1)));
		int x0 = (int)cx, y0 = (int)cy;
		int x1 = std::min(x0 + 1, myGW - 1), y1 = std::min(y0 + 1, myGH - 1);
		float fx = cx - x0, fy = cy - y0;
		float a = cells[y0 * myGW + x0], b = cells[y0 * myGW + x1];
		float c = cells[y1 * myGW + x0], d = cells[y1 * myGW + x1];
		return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
	}

	void calibrate(const uint8_t* in, int w, int h, size_t rowBytes, const EngineParams& p)
	{
		// vast: niets meer bijstellen, behalve direct na een Reset (dan is myCells leeg en meet hij één keer volledig)
		if (p.lock && !myCells.empty() && myGW == (w + myCell - 1) / myCell && myGH == (h + myCell - 1) / myCell)
			return;
		const int gw = (w + myCell - 1) / myCell, gh = (h + myCell - 1) / myCell;
		if (gw != myGW || gh != myGH)
		{
			myGW = gw;
			myGH = gh;
			myCells.clear();
		}
		// 1. dominante blauwtint via chromaticiteit-histogram op een grof raster
		const int HB = 48;
		std::vector<int> hist(HB * HB, 0);
		const int step = 8;
		for (int y = 0; y < h; y += step)
		{
			const uint8_t* s = in + (size_t)y * rowBytes;
			for (int x = 0; x < w; x += step)
			{
				float b = s[4 * x] / 255.f, g = s[4 * x + 1] / 255.f, r = s[4 * x + 2] / 255.f;
				float sum = r + g + b;
				if (b - std::max(r, g) < 0.05f || sum < 0.06f) continue;
				// papier = verzadigd blauw. Een blauwig verlichte grijze trui kan groter zijn dan het papier
				// in beeld, maar is veel minder verzadigd: alleen verzadigde pixels tellen, en zwaarder naarmate verzadigder.
				float sat = (b - std::min(r, g)) / std::max(b, 1e-3f);
				if (sat < 0.45f) continue;
				int hr = std::min(HB - 1, (int)(r / sum * HB)), hg = std::min(HB - 1, (int)(g / sum * HB));
				hist[hg * HB + hr] += (int)(sat * sat * 16.f);
			}
		}
		int best = -1, bestCount = 0;
		for (int i = 0; i < HB * HB; ++i)
		{
			int c = 0;
			int bx = i % HB, by = i / HB;
			for (int dy = -1; dy <= 1; ++dy)
				for (int dx = -1; dx <= 1; ++dx)
				{
					int xx = bx + dx, yy = by + dy;
					if (xx >= 0 && yy >= 0 && xx < HB && yy < HB) c += hist[yy * HB + xx];
				}
			if (c > bestCount) { bestCount = c; best = i; }
		}
		float pr = best >= 0 ? ((best % HB) + 0.5f) / HB : 0.15f;
		float pg = best >= 0 ? ((best / HB) + 0.5f) / HB : 0.25f;
		const float tol = 3.5f / HB;  // tolerantie rond de papiertint

		// 2. per vak: blauw-niveau van het papier (75e percentiel van pixels met de papiertint)
		std::vector<float> lvl(gw * gh, -1.f);
		std::vector<float> tmp;
		for (int cyi = 0; cyi < gh; ++cyi)
			for (int cxi = 0; cxi < gw; ++cxi)
			{
				tmp.clear();
				int n = 0;
				for (int y = cyi * myCell + 2; y < std::min(h, (cyi + 1) * myCell); y += 4)
				{
					const uint8_t* s = in + (size_t)y * rowBytes;
					for (int x = cxi * myCell + 2; x < std::min(w, (cxi + 1) * myCell); x += 4)
					{
						n++;
						float b = s[4 * x] / 255.f, g = s[4 * x + 1] / 255.f, r = s[4 * x + 2] / 255.f;
						float sum = r + g + b;
						if (sum < 0.04f) continue;
						if (std::fabs(r / sum - pr) < tol && std::fabs(g / sum - pg) < tol && b > std::max(r, g))
							tmp.push_back(b - std::max(r, g));
					}
				}
				if ((int)tmp.size() >= std::max(4, n / 4))
				{
					std::nth_element(tmp.begin(), tmp.begin() + tmp.size() * 3 / 4, tmp.end());
					lvl[cyi * gw + cxi] = tmp[tmp.size() * 3 / 4];
				}
			}
		// vakken zonder papier aanvullen vanuit de buren
		for (int pass = 0; pass < gw + gh; ++pass)
		{
			bool missing = false;
			std::vector<float> nxt = lvl;
			for (int y = 0; y < gh; ++y)
				for (int x = 0; x < gw; ++x)
				{
					if (lvl[y * gw + x] >= 0) continue;
					float sum = 0; int c = 0;
					for (int dy = -1; dy <= 1; ++dy)
						for (int dx = -1; dx <= 1; ++dx)
						{
							int xx = x + dx, yy = y + dy;
							if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
							float v = lvl[yy * gw + xx];
							if (v >= 0) { sum += v; c++; }
						}
					if (c) nxt[y * gw + x] = sum / c; else missing = true;
				}
			lvl.swap(nxt);
			if (!missing) break;
		}
		for (float& v : lvl) if (v < 0) v = 0.3f;

		// 3. dempen in de tijd
		const float k = myCells.empty() ? 1.f : (float)p.adapt;
		if (best >= 0)
		{
			if (myCells.empty()) { myPr = pr; myPg = pg; }
			myPr = myPr * (1 - k) + pr * k;
			myPg = myPg * (1 - k) + pg * k;
		}
		if (myCells.empty()) myCells = lvl;
		for (size_t i = 0; i < lvl.size(); ++i)
		{
			myCells[i] = myCells[i] * (1 - k) + lvl[i] * k;
		}
	}

	int myGW = 0, myGH = 0;
	std::vector<float> myCells;
	float myPr = 0.15f, myPg = 0.25f;
	std::vector<uint8_t> myKey, myTmp;
	Engine* myVision = nullptr;
	Engine* myRvm = nullptr;
	EngineResult myAiOut;
	std::vector<uint8_t> myAi;
};

// Alleen de kalibratie, voor de GPU-key in TD: verwacht een verkleind beeld (bijv. kwart resolutie)
// en geeft een klein raster terug: R = blauw-niveau van het papier per vak, G/B = papiertint (r, g chromaticiteit).
class CalibEngine : public KeyEngine
{
public:
	CalibEngine() { myCell = 8; }
	bool process(const uint8_t* in, int w, int h, size_t rowBytes,
	             const EngineParams& p, EngineResult& out, std::string& err) override
	{
		calibrate(in, w, h, rowBytes, p);
		out.width = myGW;
		out.height = myGH;
		out.bgra.resize((size_t)myGW * myGH * 4);
		auto u8 = [](float v) { return (uint8_t)(std::max(0.f, std::min(1.f, v)) * 255.f + 0.5f); };
		for (int i = 0; i < myGW * myGH; ++i)
		{
			out.bgra[4 * i + 0] = u8(myPg);
			out.bgra[4 * i + 1] = u8(myPr);
			out.bgra[4 * i + 2] = u8(myCells[i]);
			out.bgra[4 * i + 3] = 255;
		}
		return true;
	}
};

#ifdef CALIB_PLUGIN
Engine* createEngine() { return new CalibEngine(); }
const char* engineOpType() { return "Fykeycalib"; }
const char* engineOpLabel() { return "FY Key Calib"; }
const char* engineOpIcon() { return "FKC"; }
#else
Engine* createEngine() { return new KeyEngine(); }
const char* engineOpType() { return "Fykeymatte"; }
const char* engineOpLabel() { return "FY Auto Key"; }
const char* engineOpIcon() { return "FKM"; }
#endif
bool engineHasKeyParams() { return true; }
