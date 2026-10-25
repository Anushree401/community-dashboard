export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
};

export type AuthMode =
  | "login"
  | "register"
  | "verify"
  | "forgot"
  | "reset";
