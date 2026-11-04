export function validateEnvironment(env: Record<string, string | undefined>): {
  environment: string;
  hosted: boolean;
  configured: boolean;
  scanning: boolean;
  origin?: string;
  supabaseOrigin?: string;
};
