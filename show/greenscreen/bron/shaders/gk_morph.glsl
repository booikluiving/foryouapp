// Gaatjes dichten: max (dilate) of min (erode) over een vierkant van (2r+1)^2. uMorph.x = straal, uMorph.y = 1 max / 0 min
uniform vec4 uMorph;
out vec4 fragColor;
void main()
{
	ivec2 sz = textureSize(sTD2DInputs[0], 0);
	ivec2 p = ivec2(vUV.st * vec2(sz));
	int r = int(uMorph.x);
	float v = uMorph.y > 0.5 ? 0.0 : 1.0;
	for (int dy = -r; dy <= r; ++dy)
		for (int dx = -r; dx <= r; ++dx) {
			float t = texelFetch(sTD2DInputs[0], clamp(p + ivec2(dx, dy), ivec2(0), sz - 1), 0).r;
			v = uMorph.y > 0.5 ? max(v, t) : min(v, t);
		}
	fragColor = TDOutputSwizzle(vec4(v, v, v, 1.0));
}
