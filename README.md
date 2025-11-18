# Target Automation

Serviço Node.js para recuperar atividades do Adobe Target via API oficial. O projeto expõe um endpoint HTTP que autentica usando `client_credentials` e retorna os dados brutos da API do Target.

## Requisitos

- Node.js 18+
- Conta e credenciais válidas do Adobe Target

## Configuração

1. Copie o arquivo `.env.example` para `.env` e preencha com suas credenciais:

   ```bash
   cp .env.example .env
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Inicie o servidor:

   ```bash
   npm start
   ```

O serviço ficará disponível em `http://localhost:<API_PORT>` (padrão `3001`).

## Endpoints

- `GET /health` — Verificação de saúde simples.
- `GET /activities` — Retorna somente `id` e `type` das atividades do Adobe Target. Aceita os mesmos parâmetros de query suportados pela API original e os encaminha diretamente.
- `GET /activities/:type/:id` — Recupera os detalhes completos de uma atividade específica montando o endpoint correto (`/target/activities/ab/{id}` ou `/target/activities/xt/{id}`) de acordo com o tipo informado.

## Desenvolvimento

- `npm run dev` — Inicia o servidor com `nodemon` para recarregar automaticamente.
- `npm run lint` — Executa o ESLint usando a configuração Airbnb Base.

## Estrutura do projeto

```
src/
├── config/
│   └── environment.js    # Carrega e valida variáveis de ambiente
├── index.js               # Ponto de entrada do servidor Express
├── routes/
│   └── activities.js     # Rotas para atividades do Adobe Target
└── services/
    └── adobeTargetService.js # Cliente para autenticação e consumo da API do Target
```

## Observações

- O arquivo `.env` está no `.gitignore` para evitar exposição de segredos.
- Os tokens de acesso são armazenados em cache em memória até expirar para evitar chamadas redundantes ao serviço de autenticação.
