// Voorhoofd-volger: zoekt het gezicht met Apple Vision en geeft de plek van een kaartje op het voorhoofd.
// Glad (one-euro-filter), negeert losse uitschieters, houdt de plek even vast als het gezicht wegvalt
// en glijdt daarna naar een vaste terugvalplek. Coördinaten: genormaliseerd, oorsprong linksonder (zoals TD).
#pragma once
#include <cstdint>
#include <cstddef>
#include <string>

struct VoorhoofdParams
{
	double maat = 0.95;        // kaartje = maat × gezichtsbreedte
	double afstand = 0.08;     // ruimte tussen wenkbrauwen en onderkant kaartje, × gezichtsbreedte
	double meedraaien = 1.0;   // 0 = altijd rechtop, 1 = draait helemaal mee met het hoofd
	double rust = 1.0;         // one-euro min cutoff (Hz): lager = rustiger, trager
	double volg = 0.6;         // one-euro beta: hoger = volgt snelle bewegingen beter
	double houd = 0.7;         // s: zo lang blijft het kaartje staan als het gezicht kwijt is
	double overgang = 0.45;    // s: glijden van/naar de terugvalplek
	double terugX = 0.5, terugY = 0.8, terugMaat = 0.35;  // terugvalplek (midden kaartje), maat × beeldbreedte
	double minZeker = 0.5;     // Vision-zekerheid
	double minGezicht = 0.04;  // kleinste gezichtsbreedte (× beeldbreedte)
	int bevestig = 3;          // zoveel beelden achter elkaar nodig voor een sprong of na kwijt
};

struct VoorhoofdUit
{
	double x = 0.5, y = 0.8;   // midden van het kaartje
	double maat = 0.35;        // breedte kaartje, × beeldbreedte
	double hoek = 0;           // graden, tegen de klok in
	double volgt = 0;          // 0 = terugvalplek, 1 = op het voorhoofd (glijdt)
	int gezicht = 0;           // dit beeld een bruikbaar gezicht
	int gezichten = 0;         // aantal gevonden gezichten
	double zekerheid = 0;
};

class Voorhoofd
{
public:
	Voorhoofd();
	~Voorhoofd();
	// in: BGRA8, bovenste rij eerst. t in seconden (oplopend).
	bool verwerk(const uint8_t* in, int w, int h, size_t rowBytes, double t,
	             const VoorhoofdParams& p, VoorhoofdUit& uit, std::string& err);
	void reset();
private:
	struct Impl;
	Impl* d;
};
