import {
  defineNode,
  FieldComposer,
  isRecord,
  NodeOutput,
  readFields,
  type FieldDefinition,
  type NodeHandler,
  type NodeInvocation,
} from '@runflux/runtime';

export interface SetParameters {
  readonly fields: readonly FieldDefinition[];
  readonly includeOtherFields: boolean;
}

/** Composes an object from the configured fields, optionally on top of the input object's fields. */
export class SetNode implements NodeHandler<SetParameters> {
  constructor(private readonly composer = new FieldComposer()) {}

  execute({ parameters, input }: NodeInvocation<SetParameters>): NodeOutput {
    const base = parameters.includeOtherFields && isRecord(input) ? input : {};
    return NodeOutput.main(this.composer.compose(parameters.fields, base));
  }
}

export default defineNode<SetParameters>({
  parseParameters: (parameters) => ({
    fields: readFields(parameters, 'fields'),
    includeOtherFields: parameters.boolean('includeOtherFields', false),
  }),
  createHandler: () => new SetNode(),
});
