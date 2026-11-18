// Engine met Apple Vision persoonssegmentatie (VNGeneratePersonSegmentationRequest).
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreVideo/CoreVideo.h>
#include <Accelerate/Accelerate.h>
#include "Engine.h"
#include "Compose.h"

class VisionEngine : public Engine
{
public:
	VisionEngine()
	{
		@autoreleasepool
		{
			myHandler = [[VNSequenceRequestHandler alloc] init];
			myRequest = [[VNGeneratePersonSegmentationRequest alloc] init];
			myRequest.outputPixelFormat = kCVPixelFormatType_OneComponent8;
		}
	}

	~VisionEngine() override
	{
		myRequest = nil;
		myHandler = nil;
	}

	void reset() override
	{
		@autoreleasepool
		{
			myHandler = [[VNSequenceRequestHandler alloc] init];
		}
	}

	bool process(const uint8_t* in, int w, int h, size_t rowBytes,
	             const EngineParams& p, EngineResult& out, std::string& err) override
	{
		@autoreleasepool
		{
			VNGeneratePersonSegmentationRequestQualityLevel q =
				p.quality == 0 ? VNGeneratePersonSegmentationRequestQualityLevelFast :
				p.quality == 2 ? VNGeneratePersonSegmentationRequestQualityLevelAccurate :
				                 VNGeneratePersonSegmentationRequestQualityLevelBalanced;
			if (myRequest.qualityLevel != q)
				myRequest.qualityLevel = q;

			CVPixelBufferRef pb = nullptr;
			CVReturn cr = CVPixelBufferCreateWithBytes(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA,
				(void*)in, rowBytes, nullptr, nullptr, nullptr, &pb);
			if (cr != kCVReturnSuccess || !pb)
			{
				err = "CVPixelBufferCreateWithBytes mislukt";
				return false;
			}
			NSError* e = nil;
			BOOL ok = [myHandler performRequests:@[myRequest] onCVPixelBuffer:pb error:&e];
			CVPixelBufferRelease(pb);
			if (!ok || myRequest.results.count == 0)
			{
				err = std::string("Vision: ") + (e ? e.localizedDescription.UTF8String : "geen resultaat");
				return false;
			}
			CVPixelBufferRef mask = myRequest.results.firstObject.pixelBuffer;
			CVPixelBufferLockBaseAddress(mask, kCVPixelBufferLock_ReadOnly);
			vImage_Buffer src = {CVPixelBufferGetBaseAddress(mask), (vImagePixelCount)CVPixelBufferGetHeight(mask),
			                     (vImagePixelCount)CVPixelBufferGetWidth(mask), CVPixelBufferGetBytesPerRow(mask)};
			myAlpha.resize((size_t)w * h);
			vImage_Buffer dst = {myAlpha.data(), (vImagePixelCount)h, (vImagePixelCount)w, (size_t)w};
			vImage_Error ve = vImageScale_Planar8(&src, &dst, nullptr, kvImageHighQualityResampling);
			CVPixelBufferUnlockBaseAddress(mask, kCVPixelBufferLock_ReadOnly);
			if (ve != kvImageNoError)
			{
				err = "vImageScale mislukt";
				return false;
			}
			composeBGRA(in, rowBytes, myAlpha.data(), w, h, p.output, out);
			return true;
		}
	}

private:
	VNSequenceRequestHandler* myHandler = nil;
	VNGeneratePersonSegmentationRequest* myRequest = nil;
	std::vector<uint8_t> myAlpha;
};

Engine* createVisionEngine() { return new VisionEngine(); }
#ifndef ENGINE_EMBEDDED
Engine* createEngine() { return new VisionEngine(); }
const char* engineOpType() { return "Fyvisionmatte"; }
const char* engineOpLabel() { return "FY Vision Matte"; }
const char* engineOpIcon() { return "FVM"; }
bool engineHasKeyParams() { return false; }
#endif
