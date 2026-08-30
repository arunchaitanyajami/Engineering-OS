import type { AuditEvent } from "@engineering-os/contracts/unstable-runtime";

import type {
  AuditListOptions,
  AuditRecordInput,
  AuditRepository
} from "./audit-repository.js";

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  record(input: AuditRecordInput): AuditEvent {
    return this.repository.append(input);
  }

  listRecent(options: AuditListOptions = {}): readonly AuditEvent[] {
    return this.repository.list(options);
  }
}
