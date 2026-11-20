// Test buiten TD: proef-gezichten beeld1.jpg beeld2.jpg ...
// Zelfde herkenning als FY Gezichten (VNDetectFaceRectanglesRequest, BGRA-buffer); per beeld een regel met de
// kaders (x,y,b,h, oorsprong linksboven) en de rekentijd.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <chrono>
#include <vector>

int main(int argc, char** argv)
{
	@autoreleasepool
	{
		if (argc < 2) { fprintf(stderr, "gebruik: proef-gezichten beeld...\n"); return 2; }
		VNDetectFaceRectanglesRequest* req = [[VNDetectFaceRectanglesRequest alloc] init];
		std::vector<double> ms;
		for (int i = 1; i < argc; i++)
		{
			@autoreleasepool
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
					kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
				CGContextDrawImage(ctx, CGRectMake(0, 0, w, h), img);
				CGImageRelease(img);
				CGContextRelease(ctx);
				CGColorSpaceRelease(cs);
				auto t0 = std::chrono::steady_clock::now();
				CVPixelBufferRef pb = nullptr;
				CVPixelBufferCreateWithBytes(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, buf.data(), (size_t)w * 4,
					nullptr, nullptr, nullptr, &pb);
				VNImageRequestHandler* hd = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pb options:@{}];
				NSError* e = nil;
				[hd performRequests:@[req] error:&e];
				CVPixelBufferRelease(pb);
				double t = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
				ms.push_back(t);
				printf("%s %dx%d %.1f ms:", [[url lastPathComponent] UTF8String], w, h, t);
				for (VNFaceObservation* f in req.results)
				{
					CGRect r = f.boundingBox;
					printf(" [%.3f,%.3f,%.3f,%.3f]", r.origin.x, 1.0 - r.origin.y - r.size.height, r.size.width, r.size.height);
				}
				printf("\n");
			}
		}
		double som = 0;
		for (size_t k = 1; k < ms.size(); k++) som += ms[k];
		if (ms.size() > 1) printf("gemiddeld (zonder eerste): %.1f ms\n", som / (ms.size() - 1));
	}
	return 0;
}
