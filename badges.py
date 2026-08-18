# -*- coding: utf-8 -*-
L, A = 300, 150
def card(x, titulo, corpo):
    return f'''<g transform="translate({x},0)">
  <rect x="0" y="0" width="{L}" height="{A}" rx="14" fill="#ffffff" stroke="#efece4"/>
  <text x="18" y="30" font-family="Arial" font-size="15" font-weight="bold" fill="#0e2a1a">Arena Bola na Rede</text>
  <text x="18" y="50" font-family="Arial" font-size="11.5" fill="#7a8580">Jardim Goias - 4 km</text>
  {corpo}
  <text x="18" y="132" font-family="Arial" font-size="16" font-weight="bold" fill="#0e2a1a">R$ 120</text>
  <text x="70" y="132" font-family="Arial" font-size="10" fill="#7a8580">/hora</text>
  <rect x="192" y="116" width="92" height="24" rx="12" fill="#16a765"/>
  <text x="238" y="132" font-family="Arial" font-size="10.5" fill="#fff" text-anchor="middle">Ver horarios</text>
</g>'''

ATUAL = '''<rect x="18" y="64" width="52" height="21" rx="10.5" fill="#edf7f0"/>
<text x="44" y="78.5" font-family="Arial" font-size="10.5" fill="#0e4f25" text-anchor="middle">Areia</text>
<rect x="76" y="64" width="64" height="21" rx="10.5" fill="#edf7f0"/>
<text x="108" y="78.5" font-family="Arial" font-size="10.5" fill="#0e4f25" text-anchor="middle">Coberta</text>
<line x1="18" y1="99" x2="282" y2="99" stroke="#efece4"/>'''

A_META = '''<g stroke="#7a8580" stroke-width="1.4" fill="none" stroke-linecap="round">
  <path d="M22 74c1.6-1.2 3.2-1.2 4.8 0"/><path d="M24.4 70.5v-2"/>
  <rect x="78" y="68.5" width="9" height="9" rx="1.5"/>
</g>
<text x="32" y="77" font-family="Arial" font-size="11" fill="#5a6560">Areia</text>
<text x="92" y="77" font-family="Arial" font-size="11" fill="#5a6560">Coberta</text>
<line x1="18" y1="99" x2="282" y2="99" stroke="#efece4"/>'''

B_CONTORNO = '''<rect x="18" y="63" width="54" height="22" rx="6" fill="none" stroke="#dfe4e0"/>
<text x="45" y="78" font-family="Arial" font-size="10.5" fill="#44504a" text-anchor="middle">Areia</text>
<rect x="78" y="63" width="66" height="22" rx="6" fill="none" stroke="#dfe4e0"/>
<text x="111" y="78" font-family="Arial" font-size="10.5" fill="#44504a" text-anchor="middle">Coberta</text>
<line x1="18" y1="99" x2="282" y2="99" stroke="#efece4"/>'''

C_TEXTO = '''<text x="18" y="77" font-family="Arial" font-size="11.5" fill="#5a6560">Areia</text>
<circle cx="56" cy="73" r="1.4" fill="#b9c2bd"/>
<text x="64" y="77" font-family="Arial" font-size="11.5" fill="#5a6560">Coberta</text>
<circle cx="112" cy="73" r="1.4" fill="#b9c2bd"/>
<text x="120" y="77" font-family="Arial" font-size="11.5" fill="#5a6560">Bar</text>
<line x1="18" y1="99" x2="282" y2="99" stroke="#efece4"/>'''

opcoes = [("HOJE", ATUAL), ("A  icone + texto", A_META), ("B  contorno neutro", B_CONTORNO), ("C  texto com ponto", C_TEXTO)]
larg = len(opcoes)*(L+22)+22
p=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{larg}" height="{A+52}" viewBox="0 0 {larg} {A+52}">',
   f'<rect width="{larg}" height="{A+52}" fill="#f5f4ee"/>']
for i,(nome,corpo) in enumerate(opcoes):
    x=22+i*(L+22)
    p.append(f'<text x="{x}" y="20" font-family="Arial" font-size="12" font-weight="bold" fill="#44504a">{nome}</text>')
    p.append(f'<g transform="translate(0,32)">{card(x,nome,corpo)}</g>')
p.append("</svg>")
open(r"c:\tmp\badges.svg","w",encoding="utf-8").write("\n".join(p))
