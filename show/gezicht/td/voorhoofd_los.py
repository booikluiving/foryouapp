"""For_You: kaartje op het voorhoofd uit de show halen. comp1 weer direct aan speler_zicht_1."""
comp = op("/project1/comp1")
over = op("/project1/speler_voorhoofd_1")
zicht = op("/project1/speler_zicht_1")
if over is not None and over in comp.inputs:
    comp.inputConnectors[[i.path for i in comp.inputs].index(over.path)].connect(zicht)
    print("los: comp1 hangt weer aan speler_zicht_1")
else:
    print("niets te doen: comp1 hing niet aan speler_voorhoofd_1")
