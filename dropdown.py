# -*- coding: utf-8 -*-
F = {
 "futebol": '<circle cx="12" cy="12" r="10"/><path d="M12 7.8 15.99 10.7 14.47 15.38H9.53L8.01 10.7Z"/><path d="M12 7.8V2.8"/><path d="m15.99 10.7 4.76-1.54"/><path d="m14.47 15.38 2.94 4.06"/><path d="M9.53 15.38 6.59 19.44"/><path d="M8.01 10.7 3.25 9.16"/>',
 "basquete": '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M5 4.2c3.6 3.4 3.6 12.2 0 15.6"/><path d="M19 4.2c-3.6 3.4-3.6 12.2 0 15.6"/>',
 "volei": '<circle cx="12" cy="12" r="10"/><path d="M11 7a16 16 20 0 1 10.98 4.362"/><path d="M12 12a13 13 0 0 1-8.66 5"/><path d="M16.83 13.634a16 16 0 0 1-9.267 7.328"/><path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10"/><path d="M8.17 15.366a16 16 0 0 1-1.713-11.69"/>',
 "tenis": '<circle cx="12" cy="12" r="10"/><path d="M3.6 6.2c5 2.7 11.8 2.7 16.8 0"/><path d="M3.6 17.8c5-2.7 11.8-2.7 16.8 0"/>',
 "beach": '<circle cx="12" cy="9.5" r="6.4"/><path d="M6.1 7c3.7 1.7 8.1 1.7 11.8 0"/><path d="M6.1 12c3.7-1.7 8.1-1.7 11.8 0"/><path d="M2.5 19.5c2.2-1.5 4.4-1.5 6.5 0s4.3 1.5 6.5 0 4.4-1.5 6-.4"/>',
}
ITENS = [("Basquete","basquete"),("Beach Tennis","beach"),("Futebol Society","futebol"),
         ("Futsal","futebol"),("Tenis","tenis"),("Volei","volei")]
L,H = 300, 44
alt = H*len(ITENS)+24
p=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{L}" height="{alt}" viewBox="0 0 {L} {alt}">',
   f'<rect width="{L}" height="{alt}" rx="12" fill="#fff" stroke="#e6e2d8"/>']
for i,(rot,ic) in enumerate(ITENS):
    y = 12+i*H
    p.append(f'<g transform="translate(20,{y+11}) scale(0.9)" fill="none" stroke="#16a765" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{F[ic]}</g>')
    p.append(f'<text x="56" y="{y+28}" font-family="Arial" font-size="14" fill="#0e2a1a">{rot}</text>')
p.append("</svg>")
open(r"c:\tmp\dropdown.svg","w",encoding="utf-8").write("\n".join(p))
