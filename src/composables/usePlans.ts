import { useAnsData } from "./useAnsData";
import { parsePlans } from "../plans";
import { PLANS_REFRESH_MS, PLANS_URL, ZONES_ENABLED } from "../config";

export function usePlans() {
  const { items, error, loaded } = useAnsData(
    PLANS_URL,
    parsePlans,
    PLANS_REFRESH_MS,
    ZONES_ENABLED,
  );
  return { plans: items, error, loaded };
}
