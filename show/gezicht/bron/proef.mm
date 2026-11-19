// Test buiten TD: proef uitmap fps beeld1.jpg beeld2.jpg ...
// Draait de volger over de beelden (als één reeks met de opgegeven fps), schrijft per beeld een regel
// en een jpg met het kaartje erop (geel = op het voorhoofd, rood = terugvalplek).
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include "Voorhoofd.h"
#include <chrono>
#include <cmath>
#include <vector>

int main(int argc, char** argv)
{
	@autoreleasepool
	{
		if (argc < 4) { fprintf(stderr, "gebruik: proef uitmap fps beeld...\n"); return 2; }
		NSString* uitmap = [NSString stringWithUTF8String:argv[1]];
		[[NSFileManager defaultManager] createDirectoryAtPath:uitmap withIntermediateDirectories:YES attributes:nil error:nil];
		double fps = atof(argv[2]);
		Voorhoofd v;
		VoorhoofdParams p;
		std::vector<double> ms;
		printf("beeld,gezicht,volgt,x,y,maat,hoek,ms\n");
		for (int i = 3; i < argc; i++)
		{
			NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[i]]];
			CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)url, nullptr);
			if (!src) continue;
			CGImageRef img = CGImageSourceCreateImageAtIndex(src, 0, nullptr);
			CFRelease(src);
			int w = (int)CGImageGetWidth(img), h = (int)CGImageGetHeight(img);
			std::vector<uint8_t> buf((size_t)w * h * 4);
			CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
			CGContextRef ctx = CGBitmapContextCreate(buf.data(), w, h, 8, w * 4, cs,
				kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);  // BGRA, bovenste rij eerst
			CGContextDrawImage(ctx, CGRectMake(0, 0, w, h), img);
			CGImageRelease(img);

			VoorhoofdUit u;
			std::string err;
			auto t0 = std::chrono::steady_clock::now();
			bool ok = v.verwerk(buf.data(), w, h, (size_t)w * 4, (i - 3) / fps, p, u, err);
			double t = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
			ms.push_back(t);
			if (!ok) { fprintf(stderr, "fout: %s\n", err.c_str()); return 1; }
			printf("%d,%d,%.2f,%.4f,%.4f,%.4f,%.1f,%.1f\n", i - 3, u.gezicht, u.volgt, u.x, u.y, u.maat, u.hoek, t);

			// kaartje tekenen (CG: oorsprong linksonder, net als de uitvoer)
			double s = u.maat * w;
			CGContextSaveGState(ctx);
			CGContextTranslateCTM(ctx, u.x * w, u.y * h);
			CGContextRotateCTM(ctx, u.hoek * M_PI / 180);
			CGContextSetRGBStrokeColor(ctx, u.volgt > 0.5 ? 1 : 1, u.volgt > 0.5 ? 0.85 : 0.1, 0.1, 1);
			CGContextSetLineWidth(ctx, 3);
			CGContextStrokeRect(ctx, CGRectMake(-s / 2, -s / 2, s, s));
			CGContextRestoreGState(ctx);
			CGImageRef outImg = CGBitmapContextCreateImage(ctx);
			NSString* pad = [uitmap stringByAppendingPathComponent:[NSString stringWithFormat:@"p_%03d.jpg", i - 3]];
			CGImageDestinationRef dst = CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:pad],
				(__bridge CFStringRef)UTTypeJPEG.identifier, 1, nullptr);
			CGImageDestinationAddImage(dst, outImg, nullptr);
			CGImageDestinationFinalize(dst);
			CFRelease(dst);
			CGImageRelease(outImg);
			CGContextRelease(ctx);
			CGColorSpaceRelease(cs);
		}
		std::sort(ms.begin() + std::min<size_t>(3, ms.size()), ms.end());
		if (ms.size() > 4) fprintf(stderr, "mediaan %.1f ms\n", ms[3 + (ms.size() - 3) / 2]);
	}
	return 0;
}
