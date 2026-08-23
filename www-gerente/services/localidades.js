/* Estado e cidade como listas fechadas.

   Campo livre de cidade produz "Goiania", "goiania", "Goiânia" e "GOIANIA"
   como quatro lugares diferentes, e ai nenhum filtro por cidade fecha. As 27
   UFs e os 5.571 municipios do IBGE ja vem do proprio backend
   (/api/localidades), entao a lista nao depende de servico de terceiro estar
   de pe nem de request do navegador para fora.

   Este modulo nasceu de codigo que ja existia e funcionava em
   player-desktop.js (perfil da web). Foi extraido para ca porque o formulario
   de clube no app precisa exatamente do mesmo par — e duplicar traria junto
   as duas armadilhas ja resolvidas la, comentadas abaixo.

   As opcoes sao montadas por DOM (textContent), e nao por concatenacao de
   HTML: nome de cidade vem do servidor, mas montar assim tira a questao do
   escape do caminho de vez. */
import venueService from './venues.js';

let _estadosCache = null;

export async function carregarEstados() {
  /* `_estadosCache && length`, e nao so `_estadosCache`: array vazio e
     truthy, entao a versao anterior gravava a FALHA no cache e nunca mais
     tentava — bastava um tropeco de rede no primeiro carregamento para o
     campo Estado ficar vazio pelo resto da sessao. */
  if (_estadosCache && _estadosCache.length) return _estadosCache;
  try {
    _estadosCache = await venueService.estados();
  } catch (error) {
    _estadosCache = null;
    return [];
  }
  return _estadosCache;
}

function opcao(select, valor, rotulo, selecionada) {
  const item = document.createElement('option');
  item.value = valor;
  item.textContent = rotulo;
  if (selecionada) item.selected = true;
  select.appendChild(item);
}

/* Preenche o <select> de UF. `selecionado` aceita tanto a sigla quanto o nome,
   porque cadastro antigo pode ter gravado qualquer um dos dois. */
export async function montarEstados(select, selecionado = '') {
  if (!select) return [];
  const estados = await carregarEstados();
  select.innerHTML = '';
  opcao(select, '', 'Selecione');
  const alvo = String(selecionado || '').trim().toUpperCase();
  estados.forEach((uf) => {
    const sigla = uf.sigla || uf.uf || uf;
    const nome = uf.nome || sigla;
    opcao(select, sigla, `${sigla} — ${nome}`, alvo && (alvo === String(sigla).toUpperCase()
      || alvo === String(nome).toUpperCase()));
  });
  if (!estados.length) {
    select.innerHTML = '';
    opcao(select, '', 'Não foi possível carregar');
  }
  return estados;
}

/* Preenche o <select> de cidade para a UF dada. Recebe o ELEMENTO, e nao um
   seletor, para servir a qualquer formulario. */
export async function pintarCidades(select, uf, selecionada = '') {
  if (!select) return;
  select.disabled = true;
  select.innerHTML = '';
  if (!uf) {
    opcao(select, '', 'Escolha o estado primeiro');
    return;
  }
  opcao(select, '', 'Carregando…');
  try {
    const cidades = await venueService.cidadesDe(uf);
    select.innerHTML = '';
    opcao(select, '', 'Selecione');
    /* Cidade gravada antes dos dropdowns era texto livre e pode nao bater com
       a grafia do IBGE ("Goiania" x "Goiânia"). Sem isto o select cairia em
       "Selecione" e o proximo salvar apagaria a cidade da pessoa em silencio.
       Entra como opcao propria, marcada, ate ela escolher outra. */
    if (selecionada && !cidades.includes(selecionada)) {
      opcao(select, selecionada, selecionada, true);
    }
    cidades.forEach((c) => opcao(select, c, c, c === selecionada));
    select.disabled = false;
  } catch (error) {
    select.innerHTML = '';
    opcao(select, '', 'Não foi possível carregar');
  }
}

/* Liga o par: preenche as UFs, pinta as cidades da UF atual e repinta a cada
   troca. Devolve uma funcao para desligar o ouvinte quando o formulario for
   descartado — sem isso, reabrir o mesmo sheet varias vezes empilha ouvintes e
   cada troca de UF dispara N requisicoes. */
export async function ligarParEstadoCidade(selectUf, selectCidade, { uf = '', cidade = '' } = {}) {
  if (!selectUf || !selectCidade) return () => {};
  await montarEstados(selectUf, uf);
  await pintarCidades(selectCidade, selectUf.value, cidade);

  const aoTrocar = () => { pintarCidades(selectCidade, selectUf.value, ''); };
  selectUf.addEventListener('change', aoTrocar);
  return () => selectUf.removeEventListener('change', aoTrocar);
}

export default { carregarEstados, montarEstados, pintarCidades, ligarParEstadoCidade };
