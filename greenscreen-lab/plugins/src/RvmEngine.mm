// Engine met Robust Video Matting (CoreML, recurrent): het model onthoudt de vorige frames.
#import <Foundation/Foundation.h>
#import <CoreML/CoreML.h>
#import <CoreVideo/CoreVideo.h>
#include <Accelerate/Accelerate.h>
#include <algorithm>
#include "Engine.h"

static inline uint8_t toU8(float v)
{
	v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
	return (uint8_t)(v * 255.f + 0.5f);
}

class RvmEngine : public Engine
{
public:
	~RvmEngine() override { unload(); }

	void reset() override { myStates = nil; }

	bool process(const uint8_t* in, int w, int h, size_t rowBytes,
	             const EngineParams& p, EngineResult& out, std::string& err) override
	{
		@autoreleasepool
		{
			if (p.modelPath.empty())
			{
				err = "Kies een RVM-model (.mlpackage)";
				return false;
			}
			if (p.modelPath != myPath && !load(p.modelPath, err))
				return false;

			// Bron schalen naar de vaste modelresolutie
			CVPixelBufferLockBaseAddress(mySrc, 0);
			vImage_Buffer s = {(void*)in, (vImagePixelCount)h, (vImagePixelCount)w, rowBytes};
			vImage_Buffer d = {CVPixelBufferGetBaseAddress(mySrc), (vImagePixelCount)myH, (vImagePixelCount)myW,
			                   CVPixelBufferGetBytesPerRow(mySrc)};
			vImage_Error ve = (w == myW && h == myH) ? vImageCopyBuffer(&s, &d, 4, kvImageNoFlags)
			                                         : vImageScale_ARGB8888(&s, &d, nullptr, kvImageHighQualityResampling);
			CVPixelBufferUnlockBaseAddress(mySrc, 0);
			if (ve != kvImageNoError)
			{
				err = "vImage schalen mislukt";
				return false;
			}

			if (!myStates)
				myStates = zeroStates();

			NSMutableDictionary* feed = [NSMutableDictionary dictionaryWithDictionary:myStates];
			feed[@"src"] = [MLFeatureValue featureValueWithPixelBuffer:mySrc];
			NSError* e = nil;
			MLDictionaryFeatureProvider* fp = [[MLDictionaryFeatureProvider alloc] initWithDictionary:feed error:&e];
			id<MLFeatureProvider> r = fp ? [myModel predictionFromFeatures:fp error:&e] : nil;
			if (!r)
			{
				err = std::string("CoreML: ") + (e ? e.localizedDescription.UTF8String : "geen resultaat");
				myStates = nil;
				return false;
			}
			NSMutableDictionary* next = [NSMutableDictionary dictionary];
			for (int i = 1; i <= 4; ++i)
			{
				NSString* o = [NSString stringWithFormat:@"r%do", i];
				NSString* n = [NSString stringWithFormat:@"r%di", i];
				next[n] = [r featureValueForName:o];
			}
			myStates = next;

			MLMultiArray* pha = [r featureValueForName:@"pha"].multiArrayValue;
			MLMultiArray* fgr = [r featureValueForName:@"fgr"].multiArrayValue;
			out.width = myW;
			out.height = myH;
			out.bgra.resize((size_t)myW * myH * 4);
			uint8_t* o = out.bgra.data();
			const int W = myW, H = myH, mode = p.output;

			[pha getBytesWithHandler:^(const void* pb, NSInteger) {
				NSArray<NSNumber*>* ps = pha.strides;
				const long pys = ps[2].longValue, pxs = ps[3].longValue;
				const _Float16* pa = (const _Float16*)pb;
				if (mode == 1)
				{
					for (int y = 0; y < H; ++y)
						for (int x = 0; x < W; ++x)
						{
							uint8_t a = toU8((float)pa[y * pys + x * pxs]);
							uint8_t* q = o + ((size_t)y * W + x) * 4;
							q[0] = q[1] = q[2] = a;
							q[3] = 255;
						}
					return;
				}
				[fgr getBytesWithHandler:^(const void* fb, NSInteger) {
					NSArray<NSNumber*>* fs = fgr.strides;
					const long fcs = fs[1].longValue, fys = fs[2].longValue, fxs = fs[3].longValue;
					const _Float16* fa = (const _Float16*)fb;
					for (int y = 0; y < H; ++y)
						for (int x = 0; x < W; ++x)
						{
							float a = (float)pa[y * pys + x * pxs];
							a = a < 0.f ? 0.f : (a > 1.f ? 1.f : a);
							long base = y * fys + x * fxs;
							float rr = (float)fa[base], gg = (float)fa[base + fcs], bb = (float)fa[base + 2 * fcs];
							uint8_t* q = o + ((size_t)y * W + x) * 4;
							q[0] = toU8(bb * a);
							q[1] = toU8(gg * a);
							q[2] = toU8(rr * a);
							q[3] = toU8(a);
						}
				}];
			}];
			return true;
		}
	}

private:
	bool load(const std::string& path, std::string& err)
	{
		unload();
		NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
		NSError* e = nil;
		NSURL* compiled = url;
		if (![url.pathExtension isEqualToString:@"mlmodelc"])
		{
			compiled = [MLModel compileModelAtURL:url error:&e];
			if (!compiled)
			{
				err = std::string("Compileren mislukt: ") + (e ? e.localizedDescription.UTF8String : "?");
				return false;
			}
		}
		MLModelConfiguration* cfg = [[MLModelConfiguration alloc] init];
		cfg.computeUnits = MLComputeUnitsAll;
		myModel = [MLModel modelWithContentsOfURL:compiled configuration:cfg error:&e];
		if (!myModel)
		{
			err = std::string("Laden mislukt: ") + (e ? e.localizedDescription.UTF8String : "?");
			return false;
		}
		MLImageConstraint* ic = myModel.modelDescription.inputDescriptionsByName[@"src"].imageConstraint;
		myW = (int)ic.pixelsWide;
		myH = (int)ic.pixelsHigh;
		NSDictionary* attrs = @{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}};
		if (CVPixelBufferCreate(kCFAllocatorDefault, myW, myH, kCVPixelFormatType_32BGRA,
		                        (__bridge CFDictionaryRef)attrs, &mySrc) != kCVReturnSuccess)
		{
			err = "CVPixelBufferCreate mislukt";
			return false;
		}
		myPath = path;
		myStates = nil;
		return true;
	}

	NSDictionary* zeroStates()
	{
		NSMutableDictionary* d = [NSMutableDictionary dictionary];
		for (int i = 1; i <= 4; ++i)
		{
			NSString* n = [NSString stringWithFormat:@"r%di", i];
			NSArray<NSNumber*>* shape = myModel.modelDescription.inputDescriptionsByName[n].multiArrayConstraint.shape;
			NSError* e = nil;
			MLMultiArray* a = [[MLMultiArray alloc] initWithShape:shape dataType:MLMultiArrayDataTypeFloat16 error:&e];
			[a getMutableBytesWithHandler:^(void* ptr, NSInteger size, NSArray<NSNumber*>*) { memset(ptr, 0, size); }];
			d[n] = [MLFeatureValue featureValueWithMultiArray:a];
		}
		return d;
	}

	void unload()
	{
		myModel = nil;
		myStates = nil;
		if (mySrc)
			CVPixelBufferRelease(mySrc);
		mySrc = nullptr;
		myPath.clear();
	}

	std::string myPath;
	MLModel* myModel = nil;
	NSDictionary* myStates = nil;
	CVPixelBufferRef mySrc = nullptr;
	int myW = 0, myH = 0;
};

Engine* createRvmEngine() { return new RvmEngine(); }
#ifndef ENGINE_EMBEDDED
Engine* createEngine() { return new RvmEngine(); }
const char* engineOpType() { return "Fyrvmmatte"; }
const char* engineOpLabel() { return "FY RVM Matte"; }
const char* engineOpIcon() { return "FRM"; }
bool engineHasKeyParams() { return false; }
#endif
