/**
 * Typed name of a service. Keys match by name rather than identity, so a plugin and its host still
 * agree when each loaded its own copy of this module.
 */
export class ServiceKey<TService> {
  declare readonly service?: TService;

  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

/** What node handlers see of the plugin-specific services a host registered. */
export interface ServiceLookup {
  get<TService>(key: ServiceKey<TService>): TService | undefined;
}

export class ServiceRegistry implements ServiceLookup {
  private readonly services = new Map<string, unknown>();

  set<TService>(key: ServiceKey<TService>, service: TService): this {
    this.services.set(key.name, service);
    return this;
  }

  get<TService>(key: ServiceKey<TService>): TService | undefined {
    return this.services.get(key.name) as TService | undefined;
  }
}
