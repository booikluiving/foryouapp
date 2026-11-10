// RVM-tegel: camera voorvermenigvuldigd met de RVM-matte. in0 = camera, in1 = matte (grijs)
out vec4 fragColor;
void main()
{
	float m = texture(sTD2DInputs[1], vUV.st).r;
	vec3 c = texture(sTD2DInputs[0], vUV.st).rgb;
	fragColor = TDOutputSwizzle(vec4(c * m, m));
}
