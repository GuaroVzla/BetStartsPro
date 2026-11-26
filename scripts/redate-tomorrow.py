import json, datetime

with open(r'C:\Proyectos\BetStats Pro\scripts\flashscore-payload.json', encoding='utf-8') as f:
    payload = json.load(f)

# Hora actual VET (UTC-4)
now_utc = datetime.datetime.now(datetime.timezone.utc)
now_vet = now_utc - datetime.timedelta(hours=4)
today = str(now_vet.date())
tomorrow = str((now_vet + datetime.timedelta(days=1)).date())

updated = 0
for partido in payload['partidos']:
    hora = partido.get('hora_local', '') or ''
    slug = partido.get('match_slug', '') or ''
    estado = partido.get('estado', 'Programado') or 'Programado'

    # Solo partidos programados con slug fechado hoy
    if estado in ('En Vivo', 'Finalizado'):
        continue
    if not slug.startswith(today):
        continue

    # Comprobar si la hora ya paso en VET
    if ':' in hora:
        parts = hora.split(':')
        h, m = int(parts[0]), int(parts[1])
        match_dt = now_vet.replace(hour=h, minute=m, second=0, microsecond=0)
        if match_dt < now_vet:
            new_slug = slug.replace(today, tomorrow, 1)
            partido['match_slug'] = new_slug
            updated += 1

payload['fecha_extraccion'] = today
payload['total_partidos'] = len(payload['partidos'])

with open(r'C:\Proyectos\BetStats Pro\scripts\flashscore-payload.json', 'w', encoding='utf-8') as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)

print("Slugs actualizados a manana (" + tomorrow + "): " + str(updated))
print("Total partidos: " + str(len(payload['partidos'])))
