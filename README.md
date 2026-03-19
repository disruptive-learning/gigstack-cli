# gigstack CLI

Facturacion electronica desde tu terminal. CLI para la [API de gigstack](https://docs.gigstack.io).

## Instalacion

```bash
npm install -g gigstack
```

## Inicio rapido

```bash
# Autenticarse con tu API key (obtenla en app.gigstack.pro/settings > API)
gigstack login

# Verificar que todo esta configurado
gigstack doctor

# Ver tu cuenta
gigstack whoami
```

## Comandos

### Autenticacion

```bash
gigstack login                    # Login interactivo
gigstack login -k <api-key>      # Login con key inline
gigstack logout                   # Eliminar credenciales
gigstack whoami                   # Ver cuenta actual
gigstack profiles                 # Listar perfiles guardados
gigstack switch <perfil>          # Cambiar perfil activo
gigstack doctor                   # Diagnostico completo
```

### Clientes

```bash
gigstack clients list             # Listar clientes
gigstack clients get <id>         # Ver detalle
gigstack clients create           # Crear cliente (interactivo)
gigstack clients search "ACME"    # Buscar por nombre, RFC o email
gigstack clients validate <id>    # Validar datos fiscales contra SAT
gigstack clients delete <id>      # Eliminar cliente
```

Crear cliente con flags:

```bash
gigstack clients create \
  --name "Mi Empresa SA de CV" \
  --rfc MEMP850101AAA \
  --email facturacion@miempresa.com \
  --tax-system 601 \
  --zip 06600
```

### Facturas

```bash
gigstack invoices list            # Listar facturas de ingreso
gigstack invoices get <uuid>      # Ver detalle
gigstack invoices create          # Crear factura (interactivo)
gigstack invoices cancel <uuid> --motive 02   # Cancelar
gigstack invoices search "ACME"   # Buscar facturas
gigstack invoices files <uuid>    # Obtener PDF/XML
gigstack invoices drafts list     # Listar borradores
gigstack invoices drafts stamp <uuid>  # Timbrar borrador
gigstack invoices credit-notes    # Listar notas de credito
gigstack invoices complements     # Listar complementos de pago
```

Crear factura con flags:

```bash
gigstack invoices create \
  --client client_abc123 \
  --items '[{"description":"Servicio de consultoria","quantity":1,"unit_price":5000,"product_key":"84111506","unit_key":"E48","taxes":[{"type":"IVA","rate":0.16,"factor":"Tasa","withholding":false}]}]' \
  --payment-form 03 \
  --payment-method PUE
```

### Pagos

```bash
gigstack payments list            # Listar pagos
gigstack payments get <id>        # Ver detalle
gigstack payments request         # Solicitar pago (genera link de cobro)
gigstack payments register        # Registrar pago recibido
gigstack payments refund <id>     # Reembolsar
```

### Servicios

```bash
gigstack services list            # Listar servicios/productos
gigstack services get <id>        # Ver detalle
gigstack services create          # Crear servicio
gigstack services delete <id>     # Eliminar
```

### Recibos

```bash
gigstack receipts list            # Listar recibos
gigstack receipts stamp <id>      # Timbrar recibo
gigstack receipts cancel <id>     # Cancelar
```

### Webhooks

```bash
gigstack webhooks list            # Listar webhooks
gigstack webhooks create --url https://mi-servidor.com/webhook --events invoice.created,payment.succeeded
gigstack webhooks delete <id>     # Eliminar
```

### Equipos

```bash
gigstack teams list               # Listar equipos
gigstack teams get <id>           # Ver detalle
gigstack teams integrations       # Ver integraciones
```

## Opciones globales

| Flag | Descripcion |
|------|-------------|
| `--json` | Salida en formato JSON (ideal para scripts) |
| `--team <id>` | Operar sobre un equipo especifico (gigstack Connect) |
| `-h, --help` | Mostrar ayuda |
| `-V, --version` | Mostrar version |

## Autenticacion

El CLI busca credenciales en este orden:

1. Variable de entorno `GIGSTACK_API_KEY`
2. Perfil guardado en `~/.config/gigstack/credentials.json`

Las credenciales se almacenan con permisos `0600` (solo lectura por el usuario).

### Multiples perfiles

```bash
gigstack login -k <key-produccion> -p produccion
gigstack login -k <key-staging> -p staging
gigstack switch produccion
gigstack profiles
```

## Modo interactivo

Los comandos `clients create` e `invoices create` entran en modo interactivo cuando no se pasan flags. El modo interactivo te guia paso a paso:

- Busqueda de cliente por nombre/RFC/email
- Seleccion de cliente de la lista
- Construccion de conceptos uno por uno
- Seleccion de forma y metodo de pago
- Resumen y confirmacion antes de timbrar

## gigstack doctor

Ejecuta `gigstack doctor` para verificar:

- Version de Node.js
- Credenciales configuradas
- Tipo de API key (test/produccion)
- Conexion a la API
- Equipo, RFC y regimen fiscal
- Estado de conexion SAT y vigencia del CSD
- Integraciones activas
- Acceso a todos los endpoints

## Uso en scripts

```bash
# Listar facturas en JSON
gigstack invoices list --json | jq '.[] | {uuid, total, status}'

# Exportar clientes a CSV
gigstack clients list --json | jq -r '.[] | [.id, .legal_name, .tax_id, .email] | @csv'

# Usar en CI/CD con variable de entorno
export GIGSTACK_API_KEY=tu_api_key
gigstack invoices list --json
```

## Desarrollo

```bash
git clone https://github.com/disruptive-learning/gigstack-cli.git
cd gigstack-cli
npm install
npm run dev -- --help       # Ejecutar en modo desarrollo
npm run build               # Compilar a dist/
```

## Links

- [API Docs](https://docs.gigstack.io)
- [App](https://app.gigstack.pro)
- [Help Center](https://helpcenter.gigstack.pro)
