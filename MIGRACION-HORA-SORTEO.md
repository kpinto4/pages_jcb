# Migración: hora del sorteo (cierre de ventas automático)

**Por qué:** antes las stikers se podían seguir comprando durante todo el día del sorteo,
incluso mientras (o después de que) jugaba la lotería local — no era justo. Ahora cada
Premio Mayor tiene una **hora de sorteo** y el sistema **cierra las ventas automáticamente
1 hora antes** de esa hora (`/api/stikers` deja de listar números y `/api/create-checkout-session`
rechaza compras nuevas).

**Ejecuta este SQL en Neon SQL Editor** antes de desplegar el nuevo backend:

1. Entra a [Neon Console](https://console.neon.tech) → tu proyecto
2. Abre **SQL Editor**
3. Copia y pega:

```sql
ALTER TABLE sorteos ADD COLUMN IF NOT EXISTS hora_sorteo TEXT;
```

4. Ejecuta (**Run**)

## Después de la migración

- El Premio Mayor **actual** ("montaña") no tiene `hora_sorteo` guardada todavía → **no se
  cerrarán las ventas por hora hasta que la definas** (sigue funcionando como antes, solo por
  fecha). Entra a **Admin → editar el sorteo** y define la hora del sorteo para que el cierre
  automático de 1 hora antes empiece a aplicar.
- De ahí en adelante, **crear un Premio Mayor nuevo pedirá la hora del sorteo como campo
  obligatorio** (igual que ya pide la imagen).
