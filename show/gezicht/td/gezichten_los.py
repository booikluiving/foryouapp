"""
For_You: ondertitel uit de gezichten weer weg. Haalt /project1/fy_gezichten weg; de ondertitel staat na 1 s weer
op zijn gewone plek. Bewaart NIET.

    exec(open('/Users/for_you/ForYou/main/show/gezicht/td/gezichten_los.py').read())
"""

c = op("/project1/fy_gezichten")
if c is not None:
    c.destroy()
print("fy_gezichten weg (NIET bewaard)")
