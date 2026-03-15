const emailLocalPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const emailDomainPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export const emailDomainLabel = "example.com";
export const emailAddressLabel = "name@example.com";

export function parseEmail(raw: string): string {
  const value = raw.trim().toLowerCase();
  const [local, domain, ...rest] = value.split("@");
  if (!local || !domain || rest.length > 0) {
    throw new Error(`Invalid email value "${raw}"`);
  }
  if (!emailLocalPattern.test(local) || !emailDomainPattern.test(domain)) {
    throw new Error(`Invalid email value "${raw}"`);
  }
  return `${local}@${domain}`;
}

export function parseEmailQuery(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) {
    throw new Error("Email filter value cannot be empty");
  }
  return value;
}

export function parseEmailDomain(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^@+/, "");
  if (!emailDomainPattern.test(value)) {
    throw new Error(`Invalid email domain "${raw}"`);
  }
  return value;
}
