# Leitor Patrimonial HTTPS

Projeto completo em Node.js com frontend web responsivo e mobile-first para leitura de etiquetas patrimoniais por camera, com foco em **Code 128** e fluxo preparado para **iPhone** e **Android** em **HTTPS**.

## Recursos

- Servidor local HTTPS em Node.js, sem dependencias de backend extras
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
|-- certs/
|   |-- .gitkeep
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

## 2. Como gerar ou configurar certificados HTTPS locais

O servidor espera estes arquivos:

- `certs/localhost-key.pem`
- `certs/localhost.pem`

### Opcao A: usando o script Node incluido

O projeto ja inclui um gerador de certificado PEM sem OpenSSL:

```bash
npm run generate-cert
```

Ele cria:

- `certs/localhost-key.pem`
- `certs/localhost.pem`

E inclui automaticamente:

- `localhost`
- `127.0.0.1`
- os IPs IPv4 locais ativos da maquina no momento da geracao

Se o IP da maquina mudar, gere novamente.

### Opcao B: usando `mkcert`

1. Instale o `mkcert`.
2. Rode:

```bash
mkcert -install
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1 192.168.0.10 192.168.0.11
```

Troque ou acrescente os IPs da sua rede local. Para descobrir os IPs locais:

```bash
npm run local-ip
```

### Opcao C: usando OpenSSL

```bash
openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes ^
  -keyout certs/localhost-key.pem ^
  -out certs/localhost.pem ^
  -subj "/CN=localhost" ^
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.0.10"
```

Troque `192.168.0.10` pelo IP atual da maquina. Para acesso do celular, o IP precisa estar presente no certificado.

Se o PowerShell bloquear o comando `npm`, use `npm.cmd` no lugar no terminal atual.

## 3. Como iniciar o servidor HTTPS

```bash
npm start
```

O terminal exibira URLs como:

- `https://localhost:3443`
- `https://192.168.x.x:3443`

Tambem existe o endpoint:

- `https://localhost:3443/health`

## 4. Como acessar pelo computador

Abra:

```text
https://localhost:3443
```

## 5. Como acessar pelo iPhone e Android na mesma rede Wi-Fi

1. Conecte o computador e o celular na mesma rede Wi-Fi.
2. Descubra o IP local do computador com `npm run local-ip`.
3. Gere o certificado incluindo esse IP no `subjectAltName`.
4. Inicie o servidor com `npm start`.
5. No celular, abra:

```text
https://SEU-IP-LOCAL:3443
```

## 6. Como confiar no certificado local no celular

### iPhone

1. Gere o certificado com `mkcert` ou exporte a CA usada.
2. Envie o certificado confiavel para o iPhone.
3. Instale o perfil no aparelho.
4. Va em `Ajustes > Geral > Sobre > Ajustes de Confianca de Certificados`.
5. Habilite confianca total para o certificado.

### Android

1. Instale o certificado da autoridade emissora ou use o fluxo do `mkcert`.
2. Em muitos aparelhos, basta aceitar o aviso do certificado para testes locais.
3. Em aparelhos mais restritivos, instale o certificado em `Seguranca > Credenciais`.

## 7. Limitacoes conhecidas do iOS

- iOS exige HTTPS real para camera em navegadores baseados em WebKit.
- Safari, Chrome, Edge e Firefox no iPhone compartilham as mesmas limitacoes de motor.
- Controle fino de foco e zoom varia por aparelho e versao do iOS.
- Se o certificado nao for confiavel, a camera pode falhar ou a permissao pode nao ser concedida.
- Em segundo plano, o navegador pode suspender o video; o projeto interrompe o stream para evitar inconsistencias.

## 8. Como testar a leitura da etiqueta patrimonial anexa

1. Abra a pagina no celular por HTTPS.
2. Toque em `Iniciar leitura`.
3. Permita o acesso a camera.
4. Posicione a etiqueta na moldura central.
5. Ajuste a distancia ate o numero ficar nitido, semelhante a `00619520`.
6. Ao detectar, a leitura para automaticamente e o valor aparece em destaque.

## Compatibilidade pensada no projeto

- iPhone: Safari, Chrome, Edge e Firefox
- Android: Chrome, Edge, Firefox e Samsung Internet

O projeto usa:

- `getUserMedia` em HTTPS
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

- Para uso interno mais estavel, prefira certificado confiado pela empresa, `mkcert` em ambiente controlado ou proxy HTTPS.
- Se quiser maximizar a leitura da etiqueta patrimonial, teste a distancia ideal do aparelho e a iluminacao do ambiente real.
- Se algum aparelho abrir a camera frontal, revise se o navegador respeitou `environment`; alguns dispositivos antigos tratam isso apenas como preferencia.
