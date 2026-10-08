import { ref, watch } from "vue";

// Tiny i18n: a reactive language and a key → text lookup. Reading `t()` inside a
// template or computed makes it update when the language changes.

export type Lang = "en" | "lt";
export const LANGS: [Lang, string][] = [
  ["en", "English"],
  ["lt", "Lietuvių"],
];

const KEY = "geomap.lang";

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "lt") return saved;
  } catch {
    // storage blocked
  }
  return navigator.language.toLowerCase().startsWith("lt") ? "lt" : "en";
}

export const lang = ref<Lang>(initial());

watch(
  lang,
  (l) => {
    document.documentElement.lang = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // storage blocked: choice lasts for this page only
    }
  },
  { immediate: true },
);

// For Intl / toLocale*String
export const locale = () => (lang.value === "lt" ? "lt-LT" : "en-GB");

const en = {
  // Drone list
  "list.drones": "Drones ({n})",
  "list.empty": "No drones detected",
  "list.follow": "Follow",
  "list.unfollow": "Stop following",
  "list.export": "Export track",
  "list.exportTo": "Export track:",
  "alerts.title": "Alerts ({n})",
  "alerts.export": "Export CSV",
  "alerts.clear": "Clear",
  "alerts.empty": "No alerts",
  "alerts.gone": "Drone is no longer on the map",
  // Alert / toast messages
  "msg.newDrone": "New drone detected",
  "msg.prohibited": "Entered prohibited zone {name}",
  "msg.above": "Above {m} m",
  // Flight stats
  "stats.altitude": "Altitude",
  "stats.altitudeAria": "Altitude over time, max {m} m",
  "stats.maxSpeed": "Max speed",
  "stats.maxAlt": "Max alt",
  "stats.above": "Above {m} m",
  "stats.fromPilot": "Max from pilot",
  "stats.fromTakeoff": "Max from takeoff",
  "stats.distance": "Distance",
  "stats.prohibited": "Prohibited entries",
  "stats.started": "Started",
  "stats.ended": "Ended",
  "stats.flightTime": "Flight time",
  "stats.gap": "Longest signal gap",
  "stats.startPos": "Start pos",
  "stats.endPos": "End pos",
  "stats.pilotPos": "Pilot pos",
  "copy.coords": "Copy coordinates",
  "copy.id": "Copy ID",
  // Map popups and layers
  "popup.drone": "Drone",
  "popup.pilot": "Pilot",
  "popup.alt": "Alt",
  "popup.speed": "Speed",
  "popup.aboveLimit": "Above {m} m limit",
  "zone.none": "No zone",
  "zone.permanent": "Permanent",
  "zone.PROHIBITED": "Prohibited",
  "zone.REQ_AUTHORISATION": "Authorisation required",
  "zone.NO_RESTRICTION": "Information",
  "zoneShort.PROHIBITED": "Prohibited",
  "zoneShort.REQ_AUTHORISATION": "Authorisation",
  "zoneShort.NO_RESTRICTION": "Info",
  "layer.dark": "Dark",
  "layer.map": "Map",
  "layer.satellite": "Satellite",
  "layer.zones": "Drone zones",
  "layer.language": "Language",
  "mode.monitor": "Monitor",
  "mode.planner": "Planner",
  "plan.title": "Sensor plan",
  "plan.rid": "Remote ID",
  "plan.audio": "Acoustic",
  "plan.video": "Camera",
  "plan.thermal": "Thermal",
  "plan.namePlaceholder": "Plan name",
  "plan.showLive": "Show live drones and alerts",
  "plan.overlap": "Coverage overlap",
  "plan.off": "Off",
  "plan.allTypes": "All types",
  "plan.overlap2": "2 sensors",
  "plan.overlap3": "3+ sensors (triangulation)",
  "plan.hidden": "In range, hidden by terrain",
  "plan.overlapsWith": "overlaps {n}",
  "plan.import": "Import",
  "plan.importTitle": "Open a plan file (CSV or JSON)",
  "plan.download": "Download",
  "plan.downloadTitle": "Plan file, can be imported again",
  "plan.csvTitle": "Deployment list for the field team",
  "plan.importEmpty": "no sensors in the file",
  "plan.importError": "Could not import: {e}",
  "plan.replaceConfirm": "Replace the current plan with the imported one?",
  "plan.saveError": "Plan not saved to the server: {e}. It is kept in this browser.",
  "plan.hint": "Drag a sensor onto the map, or click it and then click the map. Drag placed sensors to move them.",
  "plan.empty": "No sensors placed yet",
  "plan.total": "Total: {n}",
  "plan.remove": "Remove",
  "plan.clear": "Clear all",
  "plan.clearConfirm": "Remove all planned sensors?",
  "layer.title": "Map and layers",
  "layer.close": "Close",
  "layer.base": "Map base",
  "layer.overlays": "Layers",
  "layer.light": "Light",
  "layer.light.desc": "Muted map, drones stand out",
  "layer.dark.desc": "For night shifts",
  "layer.map.desc": "Full-colour OpenStreetMap",
  "layer.satellite.desc": "Aerial imagery",
  "layer.zones.desc": "UAS geographical zones (ANS)",
  "layer.zones.off": "Available in local development only",
  // Replay
  "replay.open": "Import and replay a track (CSV, GPX, KML)",
  "replay.import": "Import",
  "replay.loadAnother": "Load another file",
  "replay.close": "Close replay",
  "replay.play": "Play",
  "replay.pause": "Pause",
  "replay.back": "Back 5 s",
  "replay.forward": "Forward 5 s",
  "replay.speed": "Playback speed",
  "replay.drones.one": "{n} drone",
  "replay.drones.other": "{n} drones",
  "replay.err.csvColumns": "CSV needs latitude and longitude columns",
  "replay.err.xml": "Invalid XML",
  "replay.err.type": "Unsupported file type (use CSV, GPX or KML)",
  "replay.err.empty": "No track with at least 2 positions found",
  // Misc
  "toast.dismiss": "Dismiss",
  "err.detections": "Failed to load detections: {e}",
  "err.zones": "Failed to load drone zones: {e}",
};

export type MsgKey = keyof typeof en;

const lt: Record<MsgKey, string> & Record<string, string> = {
  "list.drones": "Dronai ({n})",
  "list.empty": "Dronų neaptikta",
  "list.follow": "Sekti",
  "list.unfollow": "Nebesekti",
  "list.export": "Eksportuoti trajektoriją",
  "list.exportTo": "Eksportuoti trajektoriją:",
  "alerts.title": "Įspėjimai ({n})",
  "alerts.export": "Eksportuoti CSV",
  "alerts.clear": "Išvalyti",
  "alerts.empty": "Įspėjimų nėra",
  "alerts.gone": "Drono žemėlapyje nebėra",
  "msg.newDrone": "Aptiktas naujas dronas",
  "msg.prohibited": "Įskrido į draudžiamą zoną {name}",
  "msg.above": "Virš {m} m",
  "stats.altitude": "Aukštis",
  "stats.altitudeAria": "Aukštis per laiką, daugiausia {m} m",
  "stats.maxSpeed": "Didž. greitis",
  "stats.maxAlt": "Didž. aukštis",
  "stats.above": "Virš {m} m",
  "stats.fromPilot": "Toliausiai nuo piloto",
  "stats.fromTakeoff": "Toliausiai nuo pakilimo",
  "stats.distance": "Atstumas",
  "stats.prohibited": "Draudžiami įskridimai",
  "stats.started": "Pradžia",
  "stats.ended": "Pabaiga",
  "stats.flightTime": "Skrydžio trukmė",
  "stats.gap": "Ilgiausias trūkis",
  "stats.startPos": "Pradžios vieta",
  "stats.endPos": "Pabaigos vieta",
  "stats.pilotPos": "Piloto vieta",
  "copy.coords": "Kopijuoti koordinates",
  "copy.id": "Kopijuoti ID",
  "popup.drone": "Dronas",
  "popup.pilot": "Pilotas",
  "popup.alt": "Aukštis",
  "popup.speed": "Greitis",
  "popup.aboveLimit": "Viršyta {m} m riba",
  "zone.none": "Ne zonoje",
  "zone.permanent": "Nuolatinė",
  "zone.PROHIBITED": "Draudžiama",
  "zone.REQ_AUTHORISATION": "Reikalingas leidimas",
  "zone.NO_RESTRICTION": "Informacija",
  "zoneShort.PROHIBITED": "Draudžiama",
  "zoneShort.REQ_AUTHORISATION": "Leidimas",
  "zoneShort.NO_RESTRICTION": "Info",
  "layer.dark": "Tamsus",
  "layer.map": "Žemėlapis",
  "layer.satellite": "Palydovas",
  "layer.zones": "Dronų zonos",
  "layer.language": "Kalba",
  "mode.monitor": "Stebėjimas",
  "mode.planner": "Planavimas",
  "plan.title": "Jutiklių planas",
  "plan.rid": "Remote ID",
  "plan.audio": "Akustinis",
  "plan.video": "Kamera",
  "plan.thermal": "Terminė",
  "plan.namePlaceholder": "Plano pavadinimas",
  "plan.showLive": "Rodyti gyvus dronus ir įspėjimus",
  "plan.overlap": "Aprėpties persidengimas",
  "plan.off": "Išjungta",
  "plan.allTypes": "Visi tipai",
  "plan.overlap2": "2 jutikliai",
  "plan.overlap3": "3+ jutikliai (trianguliacija)",
  "plan.hidden": "Pasiekiama, bet užstoja reljefas",
  "plan.overlapsWith": "persidengia: {n}",
  "plan.import": "Importuoti",
  "plan.importTitle": "Atidaryti plano failą (CSV arba JSON)",
  "plan.download": "Atsisiųsti",
  "plan.downloadTitle": "Plano failas, galima vėl importuoti",
  "plan.csvTitle": "Diegimo sąrašas lauko komandai",
  "plan.importEmpty": "faile nėra jutiklių",
  "plan.importError": "Nepavyko importuoti: {e}",
  "plan.replaceConfirm": "Pakeisti dabartinį planą importuotu?",
  "plan.saveError": "Planas neišsaugotas serveryje: {e}. Jis išlieka šioje naršyklėje.",
  "plan.hint": "Nutempkite jutiklį ant žemėlapio arba spustelėkite jį, tada žemėlapį. Padėtus jutiklius galima perkelti tempiant.",
  "plan.empty": "Jutiklių dar nepadėta",
  "plan.total": "Iš viso: {n}",
  "plan.remove": "Pašalinti",
  "plan.clear": "Išvalyti viską",
  "plan.clearConfirm": "Pašalinti visus suplanuotus jutiklius?",
  "layer.title": "Žemėlapis ir sluoksniai",
  "layer.close": "Uždaryti",
  "layer.base": "Žemėlapio pagrindas",
  "layer.overlays": "Sluoksniai",
  "layer.light": "Šviesus",
  "layer.light.desc": "Prislopintas, dronai išsiskiria",
  "layer.dark.desc": "Naktiniam darbui",
  "layer.map.desc": "Spalvotas OpenStreetMap",
  "layer.satellite.desc": "Aerofotonuotraukos",
  "layer.zones.desc": "UAS geografinės zonos (ANS)",
  "layer.zones.off": "Prieinama tik vietinėje aplinkoje",
  "replay.open": "Importuoti ir atkurti trajektoriją (CSV, GPX, KML)",
  "replay.import": "Importuoti",
  "replay.loadAnother": "Įkelti kitą failą",
  "replay.close": "Uždaryti atkūrimą",
  "replay.play": "Leisti",
  "replay.pause": "Pristabdyti",
  "replay.back": "Atgal 5 s",
  "replay.forward": "Pirmyn 5 s",
  "replay.speed": "Atkūrimo greitis",
  "replay.drones.one": "{n} dronas",
  "replay.drones.few": "{n} dronai",
  "replay.drones.many": "{n} drono",
  "replay.drones.other": "{n} dronų",
  "replay.err.csvColumns": "CSV faile turi būti platumos ir ilgumos stulpeliai",
  "replay.err.xml": "Neteisingas XML",
  "replay.err.type": "Nepalaikomas failo tipas (naudokite CSV, GPX arba KML)",
  "replay.err.empty": "Nerasta trajektorijos su bent 2 taškais",
  "toast.dismiss": "Uždaryti",
  "err.detections": "Nepavyko įkelti aptikimų: {e}",
  "err.zones": "Nepavyko įkelti dronų zonų: {e}",
};

const messages: Record<Lang, Record<string, string>> = { en, lt };

export type Params = Record<string, string | number>;

export function t(key: MsgKey, params: Params = {}): string {
  return messages[lang.value][key].replace(/\{(\w+)\}/g, (_, k) =>
    String(params[k] ?? ""),
  );
}

// Count-dependent text, e.g. plural("replay.drones", 3) → "3 dronai".
// Lithuanian has one / few / many / other forms; missing ones fall back to "other".
export function plural(base: "replay.drones", n: number): string {
  const form = new Intl.PluralRules(locale()).select(n);
  const text =
    messages[lang.value][`${base}.${form}`] ??
    messages[lang.value][`${base}.other`];
  return text.replace("{n}", String(n));
}
