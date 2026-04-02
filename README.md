# Leitor Patrimonial HTTPS

Projeto completo em Node.js com frontend web responsivo e mobile-first para leitura de etiquetas patrimoniais por camera, com foco em **Code 128** e com suporte a HTTPS local para uso no iPhone.

## Recursos

- Servidor local em Node.js com HTTPS automatico quando houver certificado local
- Interface web mobile-first com guia visual central
- Solicitacao correta de permissao de camera
- Preferencia pela camera traseira
- Ajustes extras para Safari/iPhone: video inline, preferencia por foco continuo e resolucao mais alta
- Leitura priorizando `Code 128` e suporte adicional a `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E` e `QR Code`
- Pausa imediata ao detectar um codigo valido
- Modal de resultado com botoes `Ler novamente` e `Copiar codigo`
- Feedback visual para permissao, leitura, sucesso, falha e incompatibilidade
- Vibracao e som discreto de confirmacao quando suportados
- Limpeza correta do stream ao parar, trocar de aba ou fechar a pagina

## Estrutura

```text
.
|-- certs/
|-- public/
|   |-- app.js
|   |-- index.html
|   |-- styles.css
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

Isso instala a biblioteca `html5-qrcode`, usada no navegador para leitura de codigo de barras com foco em boa compatibilidade mobile.

## 2. Como preparar HTTPS local para iPhone

Gere um certificado local de desenvolvimento:

```bash
npm run cert
```

Esse comando cria:

- `certs/dev-key.pem`
- `certs/dev-cert.pem`

Se esses arquivos existirem, o servidor iniciara automaticamente em `HTTPS`.

## 3. Como iniciar o servidor

```bash
npm start
```

O terminal exibira URLs como:

- `https://localhost:3000`
- `https://192.168.x.x:3000`

Se nao houver certificado local, o servidor continuara disponivel em `http://...`, mas no iPhone a camera costuma exigir `HTTPS`.

Tambem existe o endpoint:

- `https://localhost:3000/health`

## 4. Como acessar pelo computador

Abra `https://localhost:3000` quando houver certificado local. Sem certificado, use `http://localhost:3000`.

## 5. Como acessar pelo iPhone e Android na mesma rede Wi-Fi

1. Conecte o computador e o celular na mesma rede Wi-Fi.
2. Descubra o IP local do computador com `npm run local-ip`.
3. Gere o certificado local com `npm run cert`.
4. Inicie o servidor com `npm start`.
5. No celular, abra:

```text
https://SEU-IP-LOCAL:3000
```

No primeiro acesso, o certificado local pode precisar ser confiado manualmente no aparelho para que o Safari libere a camera.

## 6. Limitacoes conhecidas

- iPhone e iPad normalmente exigem HTTPS para liberar camera em navegadores baseados em WebKit.
- Certificados autoassinados podem exigir confianca manual no iPhone.
- Em Android, muitos navegadores tambem bloqueiam camera em HTTP fora de `localhost`.
- Safari, Chrome, Edge e Firefox no iPhone compartilham as mesmas limitacoes de motor.
- Controle fino de foco e zoom varia por aparelho e versao do sistema.
- Em segundo plano, o navegador pode suspender o video; o projeto interrompe o stream para evitar inconsistencias.

## 7. Como testar a leitura da etiqueta patrimonial

1. Abra a pagina no navegador.
2. Toque em `Iniciar leitura`.
3. Permita o acesso a camera.
4. Posicione a etiqueta na moldura central.
5. Ajuste a distancia ate o numero ficar nitido.
6. Ao detectar, a leitura para automaticamente e o valor aparece em destaque.

## Compatibilidade pensada no projeto

- iPhone: Safari, Chrome, Edge e Firefox
- Android: Chrome, Edge, Firefox e Samsung Internet

O projeto usa:

- `getUserMedia`
- preferencia por `facingMode: environment`
- `html5-qrcode` com `BarcodeDetector` nativo desativado para manter comportamento previsivel no iPhone
- video inline para evitar comportamento inconsistente do Safari
- tentativa de foco continuo e ajuste moderado de zoom quando o navegador expõe esses controles
- area de leitura central reduzida para melhorar desempenho e confiabilidade
- confirmacao da mesma leitura em mais de um frame para reduzir falso positivo

## Tratamento de erros implementado

- permissao negada
- camera indisponivel
- navegador incompativel
- falha de inicializacao do video
- ausencia de leitura detectada
- limpeza do stream em reinicio, troca de aba e saida da pagina

## Observacoes de producao

- Para iPhone em rede local, HTTPS continua sendo o caminho mais confiavel.
- Se quiser maximizar a leitura da etiqueta patrimonial, teste a distancia ideal do aparelho e a iluminacao do ambiente real.
- Se algum aparelho abrir a camera frontal, revise se o navegador respeitou `environment`; alguns dispositivos antigos tratam isso apenas como preferencia.
