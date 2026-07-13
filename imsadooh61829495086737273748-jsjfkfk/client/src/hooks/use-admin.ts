import { useQuery } from "@tanstack/react-query";
import { useUser } from "./use-user";

export function useAdmin() {
  const { data: user } = useUser();

  const isAdmin = user?.role === "admin";

  return {
    isAdmin,
    user,
  };
}
