// GPU auto-key, pas 1: key-alfa.
// in0 = camera, in1 = kalibratieraster (R = blauw-niveau papier per vak, G/B = papiertint r,g)
uniform vec4 uKey;   // x = key onder, y = key boven, z = tint-tolerantie
out vec4 fragColor;

vec3 calibAt(vec2 uv)
{
	ivec2 sz = textureSize(sTD2DInputs[1], 0);
	vec2 c = uv * vec2(sz) - 0.5;
	ivec2 i0 = clamp(ivec2(floor(c)), ivec2(0), sz - 1);
	ivec2 i1 = clamp(i0 + 1, ivec2(0), sz - 1);
	vec2 f = clamp(c - floor(c), 0.0, 1.0);
	vec3 a = texelFetch(sTD2DInputs[1], i0, 0).rgb;
	vec3 b = texelFetch(sTD2DInputs[1], ivec2(i1.x, i0.y), 0).rgb;
	vec3 d = texelFetch(sTD2DInputs[1], ivec2(i0.x, i1.y), 0).rgb;
	vec3 e = texelFetch(sTD2DInputs[1], i1, 0).rgb;
	return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

void main()
{
	vec3 c = texture(sTD2DInputs[0], vUV.st).rgb;
	vec3 cal = calibAt(vUV.st);
	float ratio = (c.b - max(c.r, c.g)) / max(cal.r, 0.02);
	float s = c.r + c.g + c.b;
	float tint = 0.0;
	if (s > 0.04) {
		float tol = max(uKey.z, 0.005);
		tint = 1.0 - smoothstep(tol, 2.5 * tol, length(c.rg / s - cal.gb));
	}
	float a = 1.0 - smoothstep(uKey.x, uKey.y, ratio) * tint;
	fragColor = TDOutputSwizzle(vec4(a, a, a, 1.0));
}
