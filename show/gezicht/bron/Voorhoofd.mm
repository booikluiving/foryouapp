// Zie Voorhoofd.h. Rekent in pixels (oorsprong linksonder), geeft genormaliseerd terug.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>
#include "Voorhoofd.h"
#include <algorithm>
#include <cmath>

namespace {

const double PI = 3.14159265358979323846;

double alphaVoor(double cutoff, double dt)
{
	double tau = 1.0 / (2 * PI * cutoff);
	return 1.0 / (1.0 + tau / dt);
}

// One-euro-filter. schaal: eenheid waarin de snelheid gemeten wordt (bv. de gezichtsbreedte).
struct Euro
{
	bool begin = false;
	double x = 0, dx = 0;
	void zet(double v) { begin = true; x = v; dx = 0; }
	double stap(double v, double dt, double minCut, double beta, double schaal)
	{
		if (!begin) { zet(v); return x; }
		double ruw = (v - x) / dt;
		double ad = alphaVoor(1.0, dt);
		dx += ad * (ruw - dx);
		double cut = minCut + beta * std::fabs(dx) / std::max(1e-6, schaal);
		x += alphaVoor(cut, dt) * (v - x);
		return x;
	}
};

struct Meting
{
	double cx, cy, s, hoek, breedte, zeker;
};

double glad(double v) { v = std::min(1.0, std::max(0.0, v)); return v * v * (3 - 2 * v); }

}  // namespace

struct Voorhoofd::Impl
{
	VNDetectFaceLandmarksRequest* req = nil;
	bool spoor = false;          // er is een gezicht dat we volgen
	Euro fx, fy, fs, fh;
	double laatstGezien = -1;
	double vorigeT = -1;
	double volgt = 0;            // 0..1 (lineair, uitgang is glad)
	// kandidaat bij een sprong of bij opnieuw vinden
	int kandTel = 0;
	double kandX = 0, kandY = 0;

	Impl()
	{
		req = [[VNDetectFaceLandmarksRequest alloc] init];
		if (@available(macOS 12.0, *))
			req.revision = VNDetectFaceLandmarksRequestRevision3;
	}
};

Voorhoofd::Voorhoofd() : d(new Impl()) {}
Voorhoofd::~Voorhoofd() { delete d; }

void Voorhoofd::reset()
{
	d->spoor = false;
	d->laatstGezien = -1;
	d->vorigeT = -1;
	d->volgt = 0;
	d->kandTel = 0;
}

static bool meet(VNFaceObservation* f, int w, int h, const VoorhoofdParams& p, Meting& m)
{
	VNFaceLandmarks2D* lm = f.landmarks;
	if (!lm || !lm.leftEyebrow || !lm.rightEyebrow || !lm.leftEye || !lm.rightEye)
		return false;
	CGSize maat = CGSizeMake(w, h);
	auto gemiddelde = [&](VNFaceLandmarkRegion2D* r, double& x, double& y) {
		const CGPoint* pts = [r pointsInImageOfSize:maat];
		NSUInteger n = r.pointCount;
		x = y = 0;
		for (NSUInteger i = 0; i < n; i++) { x += pts[i].x; y += pts[i].y; }
		if (n) { x /= n; y /= n; }
		return n > 0;
	};
	double lbx, lby, rbx, rby, lex, ley, rex, rey;
	if (!gemiddelde(lm.leftEyebrow, lbx, lby) || !gemiddelde(lm.rightEyebrow, rbx, rby) ||
	    !gemiddelde(lm.leftEye, lex, ley) || !gemiddelde(lm.rightEye, rex, rey))
		return false;
	// ooglijn van links naar rechts in beeld
	double ax = lex, ay = ley, bx = rex, by = rey;
	if (ax > bx) { std::swap(ax, bx); std::swap(ay, by); }
	double hoek = std::atan2(by - ay, bx - ax);
	double upx = -std::sin(hoek), upy = std::cos(hoek);
	double breedte = f.boundingBox.size.width * w;
	if (breedte < p.minGezicht * w)
		return false;
	double s = p.maat * breedte;
	double wx = (lbx + rbx) / 2, wy = (lby + rby) / 2;
	double off = p.afstand * breedte + s / 2;
	m.cx = wx + upx * off;
	m.cy = wy + upy * off;
	m.s = s;
	m.hoek = hoek * 180 / PI;
	m.breedte = breedte;
	m.zeker = f.confidence;
	return true;
}

bool Voorhoofd::verwerk(const uint8_t* in, int w, int h, size_t rowBytes, double t,
                        const VoorhoofdParams& p, VoorhoofdUit& uit, std::string& err)
{
	@autoreleasepool
	{
		CVPixelBufferRef pb = nullptr;
		CVReturn cr = CVPixelBufferCreateWithBytes(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA,
			(void*)in, rowBytes, nullptr, nullptr, nullptr, &pb);
		if (cr != kCVReturnSuccess || !pb) { err = "CVPixelBufferCreateWithBytes mislukt"; return false; }
		VNImageRequestHandler* hd = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pb options:@{}];
		NSError* e = nil;
		BOOL ok = [hd performRequests:@[d->req] error:&e];
		CVPixelBufferRelease(pb);
		if (!ok) { err = std::string("Vision: ") + (e ? e.localizedDescription.UTF8String : "fout"); return false; }

		double dt = d->vorigeT < 0 ? 1.0 / 50 : std::min(0.5, std::max(1e-3, t - d->vorigeT));
		d->vorigeT = t;

		// bruikbare gezichten meten
		NSArray<VNFaceObservation*>* res = d->req.results;
		uit.gezichten = (int)res.count;
		bool heb = false;
		Meting best{};
		double bestScore = 1e18;
		for (VNFaceObservation* f in res)
		{
			if (f.confidence < p.minZeker) continue;
			Meting m;
			if (!meet(f, w, h, p, m)) continue;
			double score;
			if (d->spoor)
				score = std::hypot(m.cx - d->fx.x, m.cy - d->fy.x);  // dichtst bij het spoor
			else
				score = -m.breedte;                                   // grootste
			if (score < bestScore) { bestScore = score; best = m; heb = true; }
		}

		uit.gezicht = 0;
		uit.zekerheid = heb ? best.zeker : 0;
		if (heb)
		{
			double eenheid = best.breedte;
			bool nemen = false, opnieuw = false;
			if (d->spoor && std::hypot(best.cx - d->fx.x, best.cy - d->fy.x) < 0.8 * eenheid
			    && best.s < d->fs.x * 1.6 && best.s > d->fs.x / 1.6)
			{
				nemen = true;
				d->kandTel = 0;
			}
			else
			{
				// sprong of opnieuw gevonden: pas na een paar beelden op dezelfde plek
				if (d->kandTel > 0 && std::hypot(best.cx - d->kandX, best.cy - d->kandY) < 0.5 * eenheid)
					d->kandTel++;
				else
					d->kandTel = 1;
				d->kandX = best.cx;
				d->kandY = best.cy;
				if (d->kandTel >= std::max(1, p.bevestig)) { opnieuw = true; d->kandTel = 0; }
			}
			if (opnieuw)
			{
				bool wasZichtbaar = d->spoor && d->volgt > 0;
				d->fx.zet(best.cx); d->fy.zet(best.cy); d->fs.zet(best.s); d->fh.zet(best.hoek);
				d->spoor = true;
				if (!wasZichtbaar) d->volgt = 0;  // glijdt vanaf de terugvalplek
				nemen = false;
				d->laatstGezien = t;
				uit.gezicht = 1;
			}
			if (nemen)
			{
				d->fx.stap(best.cx, dt, p.rust, p.volg, eenheid);
				d->fy.stap(best.cy, dt, p.rust, p.volg, eenheid);
				d->fs.stap(best.s, dt, p.rust * 0.5, p.volg * 0.5, eenheid);
				d->fh.stap(best.hoek, dt, p.rust, p.volg, 30.0);
				d->laatstGezien = t;
				uit.gezicht = 1;
			}
		}
		else
		{
			d->kandTel = 0;
		}

		bool vers = d->spoor && d->laatstGezien >= 0 && (t - d->laatstGezien) <= p.houd;
		double stapV = dt / std::max(0.05, p.overgang);
		d->volgt = vers ? std::min(1.0, d->volgt + stapV) : std::max(0.0, d->volgt - stapV);
		if (!vers && d->volgt <= 0) d->spoor = false;

		double k = glad(d->volgt);
		double tx = p.terugX * w, ty = p.terugY * h, ts = p.terugMaat * w;
		double gx = d->spoor || k > 0 ? d->fx.x : tx;
		double gy = d->spoor || k > 0 ? d->fy.x : ty;
		double gs = d->spoor || k > 0 ? d->fs.x : ts;
		double gh = d->spoor || k > 0 ? d->fh.x * p.meedraaien : 0;
		uit.x = (tx + (gx - tx) * k) / w;
		uit.y = (ty + (gy - ty) * k) / h;
		uit.maat = (ts + (gs - ts) * k) / w;
		uit.hoek = gh * k;
		uit.volgt = k;
		return true;
	}
}
