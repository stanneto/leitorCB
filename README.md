# Leitor Patrimonial HTTP

Projeto completo em Node.js com frontend web responsivo e mobile-first para leitura de etiquetas patrimoniais por camera, com foco em **Code 128**.

## Recursos

- Servidor local HTTP em Node.js, sem dependencias de backend extras
- Interface web mobile-first com guia visual central
- Solicitacao correta de permissao de camera
- Preferencia pela camera traseira
- Leitura priorizando `Code 128` e suporte adicional a `EAN-13`, `EAN-8`, `UPC-A`, `UPC-E` e `QR Code`
- Pausa imediata ao detectar um codigo valido
- Modal de resultado com botoes `Ler novamente` e `Copiar codigo`
- Feedback visual para permissao, leitura, sucesso, falha e incompatibilidade
- Vibracao e som discreto de confirmacao quando suportados
- Limpeza correta do stream ao parar, trocar de aba ou fechar a pagina

## Estrutura

```text
.
|-- public/
|   |-- app.js
|   |-- index.html
|   |-- styles.css
|-- scripts/
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

## 2. Como iniciar o servidor HTTP

```bash
npm start
```

O terminal exibira URLs como:

- `http://localhost:3000`
- `http://192.168.x.x:3000`

Tambem existe o endpoint:

- `http://localhost:3000/health`

## 3. Como acessar pelo computador

Abra:

```text
http://localhost:3000
```

## 4. Como acessar pelo iPhone e Android na mesma rede Wi-Fi

1. Conecte o computador e o celular na mesma rede Wi-Fi.
2. Descubra o IP local do computador com `npm run local-ip`.
3. Inicie o servidor com `npm start`.
4. No celular, abra:

```text
http://SEU-IP-LOCAL:3000
```

## 5. Limitacoes conhecidas

- iPhone e iPad normalmente exigem HTTPS real para liberar camera em navegadores baseados em WebKit.
- Em Android, muitos navegadores tambem bloqueiam camera em HTTP fora de `localhost`.
- Safari, Chrome, Edge e Firefox no iPhone compartilham as mesmas limitacoes de motor.
- Controle fino de foco e zoom varia por aparelho e versao do sistema.
- Em segundo plano, o navegador pode suspender o video; o projeto interrompe o stream para evitar inconsistencias.

## 6. Como testar a leitura da etiqueta patrimonial anexa

1. Abra a pagina no navegador.
2. Toque em `Iniciar leitura`.
3. Permita o acesso a camera.
4. Posicione a etiqueta na moldura central.
5. Ajuste a distancia ate o numero ficar nitido, semelhante a `00619520`.
6. Ao detectar, a leitura para automaticamente e o valor aparece em destaque.

## Compatibilidade pensada no projeto

- iPhone: Safari, Chrome, Edge e Firefox
- Android: Chrome, Edge, Firefox e Samsung Internet

O projeto usa:

- `getUserMedia`
- preferencia por `facingMode: environment`
- `html5-qrcode` com `BarcodeDetector` nativo desativado para manter comportamento previsivel no iPhone
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

- Se voce precisar de camera em celulares reais fora de `localhost`, HTTPS continua sendo o caminho mais confiavel.
- Se quiser maximizar a leitura da etiqueta patrimonial, teste a distancia ideal do aparelho e a iluminacao do ambiente real.
- Se algum aparelho abrir a camera frontal, revise se o navegador respeitou `environment`; alguns dispositivos antigos tratam isso apenas como preferencia.
