/**
 * Typed name of a service in a ServiceRegistry. Keys match by name rather than identity, so a
 * plugin and its host still agree when each loaded its own copy of this module.
 */
export class ServiceKey<TService> {
  declare readonly service?: TService;

  constructor(readonly name: string) {}
}

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();

  set<TService>(key: ServiceKey<TService>, service: TService): this {
    this.services.set(key.name, service);
    return this;
  }

  get<TService>(key: ServiceKey<TService>): TService | undefined {
    return this.services.get(key.name) as TService | undefined;
  }
}
