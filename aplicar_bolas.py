# -*- coding: utf-8 -*-
import pathlib

FORMAS = {
 "futebol": '<circle cx="12" cy="12" r="10"/><path d="M12 7.8 15.99 10.7 14.47 15.38H9.53L8.01 10.7Z"/><path d="M12 7.8V2.8"/><path d="m15.99 10.7 4.76-1.54"/><path d="m14.47 15.38 2.94 4.06"/><path d="M9.53 15.38 6.59 19.44"/><path d="M8.01 10.7 3.25 9.16"/>',
 "basquete": '<circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/><path d="M5 4.2c3.6 3.4 3.6 12.2 0 15.6"/><path d="M19 4.2c-3.6 3.4-3.6 12.2 0 15.6"/>',
 "volei": '<circle cx="12" cy="12" r="10"/><path d="M11 7a16 16 20 0 1 10.98 4.362"/><path d="M12 12a13 13 0 0 1-8.66 5"/><path d="M16.83 13.634a16 16 0 0 1-9.267 7.328"/><path d="M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10"/><path d="M8.17 15.366a16 16 0 0 1-1.713-11.69"/>',
 "tenis": '<circle cx="12" cy="12" r="10"/><path d="M3.6 6.2c5 2.7 11.8 2.7 16.8 0"/><path d="M3.6 17.8c5-2.7 11.8-2.7 16.8 0"/>',
 "beach": '<circle cx="12" cy="9.5" r="6.4"/><path d="M6.1 7c3.7 1.7 8.1 1.7 11.8 0"/><path d="M6.1 12c3.7-1.7 8.1-1.7 11.8 0"/><path d="M2.5 19.5c2.2-1.5 4.4-1.5 6.5 0s4.3 1.5 6.5 0 4.4-1.5 6-.4"/>',
}

BLOCO_NOVO = """const SPORT_ICON_SHAPES = {
%s
};

const SPORT_ICONS = {
  'Futebol Society': 'futebol',
  Futsal: 'futebol',
  Basquete: 'basquete',
  Volei: 'volei',
  Tenis: 'tenis',
  'Beach Tennis': 'beach'
};

/* Cada esporte com a sua bola. O Lucide empacotado no projeto nao tem bola
   nenhuma alem de volleyball — por isso o mapa antigo caia em target,
   circle-dot e trophy, que nao dizem nada. Estas sao desenhadas na mesma
   grade do Lucide (24x24, traco 2, pontas arredondadas) e entram como SVG
   inline; a classe .ic cuida do tamanho e da cor. Futsal e Society dividem a
   bola porque e a mesma bola. */
function sportIcon(sport, className = 'ic') {
  const chave = SPORT_ICONS[sport]
    || SPORT_ICONS[String(sport ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  const corpo = chave && SPORT_ICON_SHAPES[chave];
  if (!corpo) return icon('trophy', className);
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${corpo}</svg>`;
}""" % ",\n".join('  %s: \'%s\'' % (k, v) for k, v in FORMAS.items())

ANTIGO = """const SPORT_ICONS = {
  'Futebol Society': 'goal',
  'Beach Tennis': 'circle-dot',
  Volei: 'volleyball',
  Basquete: 'target',
  Tenis: 'activity',
  Futsal: 'trophy'
};"""

CHAMADAS = [
    ("${icon(SPORT_ICONS[venue.sport] || 'trophy')}", "${sportIcon(venue.sport)}"),
    ("${icon(SPORT_ICONS[sport] || 'trophy')}",       "${sportIcon(sport)}"),
    ("${icon(SPORT_ICONS[item] || 'trophy')}",        "${sportIcon(item)}"),
]

for base in (r"c:\Users\Gabriel\Documents\Projetos\PARTIU QUADRA - IDEIA MILIONARIA",
             r"c:\tmp\qadras-backend"):
    for front in ("www", "www-usuario"):
        arq = pathlib.Path(base) / front / "assets" / "js" / "player-desktop.js"
        if not arq.is_file():
            continue
        s = arq.read_text(encoding="utf-8")
        if ANTIGO not in s:
            print(f"  PULADO (mapa diferente): {front} em {pathlib.Path(base).name}")
            continue
        s = s.replace(ANTIGO, BLOCO_NOVO, 1)
        n = 0
        for a, b in CHAMADAS:
            n += s.count(a); s = s.replace(a, b)
        arq.write_text(s, encoding="utf-8")
        print(f"  ok {pathlib.Path(base).name}/{front}: {n} chamadas trocadas")
