# Leitor de Código de Barras

Projeto em Node.js com front-end em React, interface mobile-first e leitura em tempo real com **ZXing**, mantendo suporte a HTTPS local para uso no iPhone.

## Motor de leitura

Este aplicativo usa **ZXing** como mecanismo principal de leitura.

- `@zxing/library` para decodificacao dos frames
- sem dependencia de `html5-qrcode`
- sem dependencia de `BarcodeDetector` nativo como mecanismo principal

## Recursos

- Servidor local em Node.js com HTTPS automatico quando houver certificado local
- Leitura em tempo real com ZXing, sem depender de `BarcodeDetector` nativo
- OCR numerico de apoio, limitado a 8 digitos, para etiquetas patrimoniais
- Front-end em React montado em um único `root`
- Interface web mobile-first com guia visual central
- Solicitacao correta de permissao de camera somente apos tocar em `Iniciar leitura`
- Preferencia pela camera traseira com fallback seguro para iPhone e Android
- Ajustes extras para Safari/iPhone: video inline, foco continuo quando disponivel e resolucao adequada
- Leitura focada em `CODE-128` numerico e OCR da numeracao visivel
- Timeout de leitura com mensagem visivel ao usuario
- Modal final com `Codigo lido`, `Copiar codigo`, `Fechar` e `Ler novamente`
- Limpeza correta do stream ao parar, trocar de aba, sair da pagina ou reiniciar a leitura

## Estrutura

```text
.
|-- certs/
|-- public/
|   |-- app.js
|   |-- index.html
|   |-- styles.css
|-- src/
|   |-- App.jsx
|   |-- barcodeUtils.js
|   |-- main.jsx
|   |-- scannerDecode.js
|   |-- scannerEnv.js
|-- scripts/
|   |-- generate-dev-certificate.mjs
|   |-- print-local-ip.mjs
|-- package.json
|-- README.md
|-- server.js
```

## 1. Como instalar dependencias

Tenha Node.js 18 ou superior instalado.

```bash
npm install
```

Isso instala React, esbuild e as bibliotecas ZXing usadas para gerar e servir o front-end.

## 2. Como preparar HTTPS local para iPhone

Gere um certificado local de desenvolvimento:

```bash
npm run cert
```

Esse comando cria:

- `certs/dev-key.pem`
- `certs/dev-cert.pem`

Se esses arquivos existirem, o servidor iniciara automaticamente em `HTTPS`.

## 3. Como gerar o front-end React

```bash
npm run build
```

Esse comando compila `src/main.jsx` e gera `public/app.js`.

## 4. Como iniciar o servidor

```bash
npm start
```

O terminal exibira URLs como:

- `https://localhost:3000`
- `https://192.168.x.x:3000`

Se nao houver certificado local, o servidor continuara disponivel em `http://...`, mas no iPhone a camera costuma exigir `HTTPS`.

Tambem existe o endpoint:

- `https://localhost:3000/health`

O script `npm start` já executa o build do React antes de subir o servidor.

## 5. Como acessar pelo computador

Abra `https://localhost:3000` quando houver certificado local. Sem certificado, use `http://localhost:3000`.

## 6. Como acessar pelo iPhone e Android na mesma rede Wi-Fi

1. Conecte o computador e o celular na mesma rede Wi-Fi.
2. Descubra o IP local do computador com `npm run local-ip`.
3. Gere o certificado local com `npm run cert`.
4. Inicie o servidor com `npm start`.
5. No celular, abra:

```text
https://SEU-IP-LOCAL:3000
```

No primeiro acesso, o certificado local pode precisar ser confiado manualmente no aparelho para que o Safari ou o Chrome no iPhone liberem a camera.

## 7. Limitacoes conhecidas

- iPhone e iPad normalmente exigem HTTPS para liberar camera em navegadores baseados em WebKit.
- Certificados autoassinados podem exigir confianca manual no iPhone.
- Em Android, muitos navegadores tambem bloqueiam camera em HTTP fora de `localhost`.
- Safari, Chrome, Edge e Firefox no iPhone compartilham o mesmo motor WebKit.
- Controle fino de foco e zoom varia por aparelho e versao do sistema.

## 8. Como testar a leitura

1. Abra a pagina no navegador.
2. Toque em `Iniciar leitura`.
3. Permita o acesso a camera.
4. Posicione a etiqueta na moldura central.
5. Ajuste a distancia ate o codigo ficar nitido.
6. Ao detectar, o app para a camera e exibe o modal `Codigo lido`.
7. Use `Fechar` para voltar ao app ou `Ler novamente` para reiniciar a leitura sem recarregar a pagina.

## Compatibilidade pensada no projeto

- iPhone: Safari e Chrome no iOS
- Android: Chrome, Edge, Firefox e Samsung Internet

O projeto usa:

- `getUserMedia`
- preferencia por `facingMode: environment`
- ZXing como mecanismo principal de decodificacao em tempo real
- Tesseract.js como fallback de OCR numerico para 8 digitos
- recortes horizontais progressivos para priorizar leitura de codigos 1D como `Code 128`
- video inline para evitar comportamento inconsistente do Safari
- tentativa de foco continuo e ajuste moderado de zoom quando o navegador expoe esses controles
- cadence de leitura controlada para reduzir aquecimento e travamentos em iPhone
- confirmacao da mesma leitura em mais de um frame para reduzir falso positivo
- timeout de leitura com encerramento limpo da camera

## Tratamento de erros implementado

- permissao negada
- ausencia de camera
- contexto inseguro
- falha ao iniciar o video
- falha do ZXing ou do OCR
- timeout de leitura
- limpeza do stream em reinicio, troca de aba e saida da pagina

## Observacoes de producao

- Para teste real no iPhone fora de `localhost`, HTTPS e obrigatorio.
- O fato de funcionar em `localhost` no desktop nao garante o mesmo comportamento no iPhone.
- Se algum aparelho abrir a camera frontal, o app tenta reapontar para a traseira sem depender de `BarcodeDetector`.

## Deploy no Vercel

Use o Vercel em HTTPS com estas configuracoes:

- Build Command: `npm run build`
- Output Directory: `public`

Este projeto inclui `vercel.json` para:

- publicar o bundle gerado em `public`
- manter fallback de SPA para `index.html`
- explicitar `Permissions-Policy: camera=(self)`

Se a camera nao abrir no Vercel:

- abra o site direto no dominio HTTPS, fora de iframe ou webview
- confirme que `https://SEU-DEPLOY.vercel.app/app.js` responde `200`
- confirme no console que `window.isSecureContext` e `true`
- no iPhone, prefira Safari ou Chrome em iOS 15.1 ou superior
