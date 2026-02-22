# Pixel Revamp Spec (Combat Mockup 9:16)

## Objetivo de UX e legibilidade
- Entregar mockup de combate mobile vertical com leitura imediata do estado de luta.
- Priorizar gameplay: inimigos no topo, zona de alvo clara, dados em serie e acao central.
- Manter estetica pulp vintage 1920-1930 com molduras Art Deco geometricas.

## Restricoes visuais nao negociaveis
- Pixel art FULL.
- Sem blur.
- Sem anti-aliasing.
- Pixels perfeitamente definidos.
- Alto contraste em toda a hierarquia de informacao.
- Icones sempre acompanhados por numero (acessibilidade).
- Numeros grandes e consistentes para HP, dano, BLK e FOCO.
- Texto minimo; tooltips curtos.

## Blueprint vertical (1080x1920, 9:16)
| Zona | Percentual | Conteudo principal |
| --- | --- | --- |
| Topo: Enemy Stage | 34% | 3 monstros grandes com HP + intencoes |
| Centro: Action Strip | 18% | Slots de alvo/drop com snap feedback |
| Centro/baixo: Dice Row | 18% | 8 dados em serie agrupados por personagem |
| Centro inferior: Roll Zone | 10% | Botao `ROLL` grande + indicador de `FOCO` |
| Rodape: Party + Info | 20% | 4 bustos, HP/BLK, status, log de 1 linha |

Regra de consistencia: os percentuais fecham 100% e nao devem ser redistribuidos sem revisao da hierarquia.

## Regras por zona

### 1) Topo: Enemy Stage (34%)
- Exibir combate em andamento com 3 monstros no topo.
- Cada monstro deve ocupar area grande e legivel.
- Cada monstro precisa de HP bar clara com numero explicito.
- Exibir icones de intencao acima do monstro (`attack`, `defense`, `status`) sempre com numero grande.
- Destacar alvo atual com outline + brilho pixel.
- Fundo do topo deve ser simples, tipo diorama leve, sem poluicao visual.

### 2) Centro: Action Strip (18%)
- Exibir faixa de alvos com slots grandes para drop.
- Aplicar linha divisoria Art Deco clara separando palco e dados.
- Feedback de selecao e arrasto com snap outline evidente.
- Tooltip curta (1 linha) para contexto de alvo/efeito.
- Touch target minimo recomendado: ~44px por slot interativo.

### 3) Centro/baixo: Dice Row (18%)
- Exibir 8 dados em linha horizontal continua.
- Se faltar espaco, quebrar para 2 linhas mantendo ordem de grupo.
- Agrupar dados por personagem com ordem fixa: Personagem 1 -> Personagem 4.
- Cada grupo deve ter mini busto/icone do personagem no topo.
- Usar separadores verticais entre grupos.
- Cada dado deve ter:
  - Borda grossa pixel.
  - Icone central grande.
  - Numero no canto.
- Estados obrigatorios de dado:
  - `locked`: cadeado pixel + brilho leve.
  - `used`: dessaturado + marcador de gasto.
  - `invalid`: dessaturado (50% alpha) + indicador de proibido.

### 4) Centro inferior: Roll Zone (10%)
- Botao `ROLL` central entre dados e party.
- Estilo Art Deco dourado com sombra pixel.
- Estados obrigatorios do botao:
  - `normal`
  - `pressed` (offset vertical negativo de 1-2px)
  - `disabled` (dessaturado)
- Mostrar `FOCO` visivel ao lado do botao, sempre com numero.

### 5) Rodape: Party + Info (20%)
- Exibir 4 personagens em bustos 1:1 com moldura Art Deco.
- Cada personagem deve mostrar HP e BLK de forma clara, com numeros.
- Mostrar icones de status compactos e legiveis (maximo recomendado de 3 + contador `+N`).
- Exibir log de combate minimo de 1 linha.
- Rodape deve manter leitura rapida sem competir com destaque dos inimigos.

## Tokens visuais
- Fundo base: `#141414`
- Painel escuro recomendado: `#1E1E1E`
- Dourado de acento discreto: `#C9A227`
- Texto principal: off-white de alto contraste
- Molduras e cantos Art Deco geometricos em linhas finas

## Diretrizes de interacao
- Drag-and-drop de dado para alvo com preview claro.
- Feedback de snap no alvo valido.
- Tap no dado para detalhe compacto de efeito.
- Hold no dado para tooltip fixa ate soltar.
- Estados visuais devem indicar rapidamente se a acao e valida ou invalida.

## Prompt mestre (versao canonica)
`Pixel art FULL, mockup de tela de combate para jogo de dados roguelike em mobile vertical 9:16 (1080x1920), estetica pulp vintage anos 1920-1930 com molduras art deco geometricas, alto contraste, sem blur, sem anti-aliasing, pixels perfeitamente definidos. Layout repaginado: topo com 3 monstros grandes e legiveis com HP bar clara e icones de intencao com numeros; faixa central de alvos com slots grandes de drop e feedback de snap; 8 dados em serie no centro/baixo agrupados por personagem (Personagem 1->4) com separadores verticais e mini busto no topo de cada grupo; botao central grande art deco "ROLL" dourado entre dados e party; rodape com 4 bustos 1:1, HP/BLK claros, status legiveis, FOCO visivel e log minimo de 1 linha. Interface limpa, leitura imediata e foco total no gameplay.`

## Checklist resumido de aceitacao visual
- [ ] Hierarquia correta: inimigos > dados > ROLL > party.
- [ ] Intencoes inimigas com leitura em menos de 2s.
- [ ] Dados em serie legiveis em menos de 2s.
- [ ] Icone + numero em intencoes, dados e recursos.
- [ ] Estados de dado (`locked`, `used`, `invalid`) inequivocos.
- [ ] Estado do botao (`normal`, `pressed`, `disabled`) evidente.
- [ ] Contraste alto com base `#141414` e acento `#C9A227`.
- [ ] Sem blur/smoothing em DPR 1 e DPR 3.
- [ ] Composicao limpa, sem excesso de texto.

## Observacao de escopo
- Este documento define a hierarquia visual alvo do combate.
- A implementacao runtime deve manter esta estrutura como referencia principal.
