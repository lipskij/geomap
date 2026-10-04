import { useAnsData } from "./useAnsData";
import { parseZones } from "../zones";
import { ZONES_ENABLED, ZONES_REFRESH_MS, ZONES_URL } from "../config";

export function useZones() {
  const { items, error, loaded } = useAnsData(
    ZONES_URL,
    parseZones,
    ZONES_REFRESH_MS,
    ZONES_ENABLED,
  );
  return { zones: items, error, loaded };
}
