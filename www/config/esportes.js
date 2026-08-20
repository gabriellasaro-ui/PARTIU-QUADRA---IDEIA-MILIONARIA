/* Posicao por modalidade.

   Nao da para ter uma lista unica: "Zagueiro" nao existe no futsal, que joga
   com Fixo, Ala e Pivo; o volei tem Levantador e Libero; o basquete tem
   Armador. Perguntar a posicao antes da modalidade produzia respostas sem
   sentido — era o que o onboarding fazia.

   A modalidade tambem e o que vai separar ranking no futuro: comparar um
   pivo de futsal com um ponteiro de volei nao significa nada.

   As chaves batem com os nomes que /api/quadras/esportes devolve, incluindo
   a falta de acento em "Tenis" e "Volei" — sao esses os valores gravados no
   banco, e divergir aqui quebraria a busca por esporte. */
/* A ordem e a lista sao daqui, e nao de /api/quadras/esportes.

   Aquele endpoint devolve o que existe de quadra cadastrada hoje — util para
   busca, inutil para perguntar em que modalidade a pessoa joga: futebol de
   campo nao aparecia so porque ainda nao ha campo cadastrado. E futebol vem
   primeiro por decisao de produto. */
export const MODALIDADES = [
  'Futsal',
  'Futebol Society',
  'Futebol de Campo',
  'Volei',
  'Futvolei'
];

export const POSICOES_POR_ESPORTE = {
  'Futsal': [
    { id: 'Goleiro', icon: 'hand' },
    { id: 'Fixo', icon: 'shield' },
    { id: 'Ala', icon: 'move-horizontal' },
    { id: 'Pivô', icon: 'goal' }
  ],
  /* Society e 7 contra 7: nao tem a linha de 4 do campo, entao Ala no lugar
     de Lateral e sem volante. */
  'Futebol Society': [
    { id: 'Goleiro', icon: 'hand' },
    { id: 'Zagueiro', icon: 'shield' },
    { id: 'Ala', icon: 'move-horizontal' },
    { id: 'Meia', icon: 'git-branch' },
    { id: 'Atacante', icon: 'goal' }
  ],
  'Futebol de Campo': [
    { id: 'Goleiro', icon: 'hand' },
    { id: 'Zagueiro', icon: 'shield' },
    { id: 'Lateral', icon: 'move-horizontal' },
    { id: 'Volante', icon: 'shield-half' },
    { id: 'Meia', icon: 'git-branch' },
    { id: 'Atacante', icon: 'goal' }
  ],
  'Volei': [
    { id: 'Levantador', icon: 'git-branch' },
    { id: 'Ponteiro', icon: 'goal' },
    { id: 'Central', icon: 'shield' },
    { id: 'Oposto', icon: 'move-horizontal' },
    { id: 'Líbero', icon: 'hand' }
  ],
  /* Futvolei e dupla: nao ha posicao de quadra, so o lado em que a pessoa
     costuma jogar. */
  'Futvolei': [
    { id: 'Direita', icon: 'move-horizontal' },
    { id: 'Esquerda', icon: 'move-horizontal' },
    { id: 'Tanto faz', icon: 'shuffle' }
  ]
};

/* Sempre oferecida, em qualquer modalidade: muita gente joga onde faltar. */
export const POSICAO_CORINGA = { id: 'Jogo de tudo', icon: 'shuffle' };

export function posicoesDe(esporte) {
  const lista = POSICOES_POR_ESPORTE[esporte];
  return lista ? [...lista, POSICAO_CORINGA] : [];
}
