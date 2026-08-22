/* Configuracao real do painel do gerente.

   IP DA REDE, e nao localhost. Este mesmo arquivo serve a versao web (aberta
   no navegador da maquina de dev) e o APK. No APK, `localhost` seria o proprio
   celular — ele nunca acharia o backend. O IP da LAN funciona nos dois casos,
   porque a maquina tambem se alcanca pelo proprio IP.

   ESSE IP MUDA a cada rede (casa, escritorio, 4G). Confira com `ipconfig` e
   atualize aqui; depois `cap sync` e rebuild, porque o valor fica compilado
   dentro do APK. Em producao troque por https://api.qadras.com.br.

   O painel do gerente e o app do jogador tem STORAGE_PREFIX diferente de
   proposito: no navegador de dev as duas telas convivem na mesma origem, e com
   o mesmo prefixo entrar como gerente derrubaria a sessao do jogador (e o
   contrario). Sao contas de papeis diferentes; nao devem disputar a mesma
   chave. */
window.__PQ_CONFIG__ = {
  API_BASE_URL: 'http://192.168.0.18:8000',
  STORAGE_PREFIX: 'pqg'
};
