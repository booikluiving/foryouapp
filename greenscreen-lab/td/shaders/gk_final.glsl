// GPU auto-key, laatste pas: verzachten, AI-hulp, randmasker, despill, uitvoer.
// in0 = camera, in1 = key-alfa (na gaatjes dichten), in2 = AI-matte (grijs, optioneel)
uniform vec4 uMix;   // x = despill, y = AI vult vanaf, z = AI aan (0/1), w = uitvoer (0 cutout, 1 matte, 2 debug)
uniform vec4 uCrop;  // randmasker links, rechts, boven, onder (fractie); alles 0 = uit
out vec4 fragColor;

void main()
{
	vec2 uv = vUV.st;
	ivec2 sz = textureSize(sTD2DInputs[1], 0);
	ivec2 p = ivec2(uv * vec2(sz));
	float aKey = 0.0;
	for (int dy = -1; dy <= 1; ++dy)
		for (int dx = -1; dx <= 1; ++dx)
			aKey += texelFetch(sTD2DInputs[1], clamp(p + ivec2(dx, dy), ivec2(0), sz - 1), 0).r;
	aKey /= 9.0;

	float f = 0.01;
	float vTop = 1.0 - uv.y;
	float inPaper = smoothstep(uCrop.x - f, uCrop.x + f, uv.x) * (1.0 - smoothstep(1.0 - uCrop.y - f, 1.0 - uCrop.y + f, uv.x))
	              * smoothstep(uCrop.z - f, uCrop.z + f, vTop) * (1.0 - smoothstep(1.0 - uCrop.w - f, 1.0 - uCrop.w + f, vTop));
	if (uCrop.x + uCrop.y + uCrop.z + uCrop.w <= 0.0) inPaper = 1.0;

	float aAi = uMix.z > 0.5 ? texture(sTD2DInputs[2], uv).a : 0.0;  // RVM-cutout: matte in alfa
	float aIn = uMix.z > 0.5 ? max(aKey, smoothstep(uMix.y, min(1.0, uMix.y + 0.1), aAi)) : aKey;
	float a = aIn * inPaper + aAi * (1.0 - inPaper);

	vec3 c = texture(sTD2DInputs[0], uv).rgb;
	if (uMix.w > 1.5) {
		float added = max(0.0, a - aKey * inPaper);
		float removed = max(0.0, aKey - a);
		fragColor = TDOutputSwizzle(vec4(removed, added, aKey * inPaper * 0.8, 1.0));
		return;
	}
	if (uMix.w > 0.5) { fragColor = TDOutputSwizzle(vec4(a, a, a, 1.0)); return; }
	float lim = max(c.r, c.g);
	if (c.b > lim) c.b = c.b - uMix.x * (c.b - lim);
	fragColor = TDOutputSwizzle(vec4(c * a, a));
}
