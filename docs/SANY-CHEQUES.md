# SANY CHEQUES — primeira versão

## Objetivo
Centralizar a relação de cheques recebidos de clientes (inclusive cheques de terceiros), repassados a fornecedores e cheques próprios emitidos pela Sany. O foco é rastrear origem, emitente, destino, localização atual e histórico.

## Regras do negócio
- “Bom para” é a data de vencimento usada nos filtros e relatórios.
- A situação de compensação presumida é calculada quando o cheque está com situação-base `repassado` e já passaram 45 dias corridos da data de vencimento.
- Compensação presumida não é confirmação bancária.
- A situação presumida não é persistida como confirmação; é calculada na view `sany_cheques_records_view`, então passa a valer com a data corrente sem depender de cron ou serviço pago.
- Se o cheque for devolvido, a situação-base passa a `devolvido` e a linha do tempo registra a mudança.
- Os registros de cheques e movimentos não podem ser apagados pelo cliente; correções devem ser feitas por atualização com histórico.
- As tabelas são isoladas por prefixo `sany_cheques_` e não alteram as tabelas existentes do SANY CONTAS.

## Estrutura
- `sany_cheques_parties`: clientes, fornecedores e outros envolvidos.
- `sany_cheques_records`: dados e situação atual do cheque, data de devolução quando conhecida, referência à origem da importação e chave única para impedir que a mesma planilha seja importada duas vezes.
- `sany_cheques_movements`: linha do tempo criada automaticamente pelo trigger quando o cheque é cadastrado, a situação/localização muda ou os dados principais são editados; o evento lista os campos alterados.
- `sany_cheques_records_view`: situação efetiva, incluindo compensação presumida após 45 dias.

## Rota
- `/cheques`: painel, relação de cheques, relatórios, cadastros e histórico.

## Segurança
- RLS habilitado nas três tabelas.
- Acesso somente a usuários autenticados do SANY CONTAS.
- Sem permissão de exclusão de cheques ou alteração/inserção direta no histórico; os movimentos são gerados pelo trigger protegido.
- A função do trigger tem search_path fixo.


## Importação das planilhas
- A origem do cheque é a aba do cliente em `Todos.xlsx`; em `Cheques sany.xlsx`, usa-se a coluna `Cliente` quando preenchida.
- `AG` e `Dayana` indicam posse interna da Sany; o marcador original deve ficar nas observações.
- `EXPK`, `Extrusa` e `Fabio - Lixo` indicam cheque repassado; não presumir que o marcador identifica um fornecedor cadastrado.
- Qualquer anotação de devolução prevalece sobre o marcador de posse/repasses anterior.
- A coluna `Cliente` na aba `Netto` contém os mesmos marcadores de localização; para a preparação inicial, ela é interpretada como marcador, e a origem permanece `Netto`.
- Registros com o mesmo banco/agência/conta/número, mas datas de vencimento divergentes, devem ser revisados antes de importar.
- Datas de devolução sem ano explícito e registros devolvidos sem data são separados para revisão; não inventar datas.
- A importação deve ser idempotente por `import_key` e preservar arquivo/aba/linha de origem. Nenhuma linha deve ser importada enquanto as divergências não forem reconciliadas.
