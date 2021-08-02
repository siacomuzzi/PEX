import { Constraints, Descriptor, Field, Optionality, PresentationDefinition } from '@sphereon/pe-models';

import { Status } from '../ConstraintUtils';
import { JsonPathUtils } from '../utils/jsonPathUtils';

import { AbstractEvaluationHandler } from './abstractEvaluationHandler';
import { EvaluationClient } from './evaluationClient';

export class LimitDisclosureEvaluationHandler extends AbstractEvaluationHandler {
  constructor(client: EvaluationClient) {
    super(client);
  }

  public getName(): string {
    return 'LimitDisclosureEvaluation';
  }

  //TODO: what is the necessary field? "@context", "credentialSchema", "credentialSubject", "type"
  static mandatoryFields: string[] = ['@context', 'id', 'credentialSchema', 'credentialSubject', 'type'];

  public handle(pd: PresentationDefinition, p: unknown): void {
    for (let i = 0; i < pd.input_descriptors.length; i++) {
      const constraints: Constraints = pd.input_descriptors[i].constraints;
      if (constraints && constraints.limit_disclosure && constraints.limit_disclosure === Optionality.Required) {
        this.limitDisclosureShouldBeEnforced(p, constraints.fields, i, pd.input_descriptors[i].id);
      }
    }
  }

  private limitDisclosureShouldBeEnforced(
    verifiablePresentation: any,
    fields: Field[],
    idIdx: number,
    inputDescriptorId: string
  ): void {
    for (let i = 0; i < verifiablePresentation.verifiableCredential.length; i++) {
      const verifiableCredentialToSend = {};
      let keys = Object.keys(verifiablePresentation.verifiableCredential[i]);
      keys = this.copyMandatoryFieldsAndDeletePredefinedKeys(
        verifiablePresentation.verifiableCredential[i],
        verifiableCredentialToSend,
        keys
      );
      this.determineNecessaryPaths(
        verifiablePresentation.verifiableCredential[i],
        verifiableCredentialToSend,
        fields,
        idIdx,
        i
      );
      if (
        this.verifiablePresentation.presentationSubmission &&
        this.verifiablePresentation.presentationSubmission.descriptor_map
      ) {
        this.copyModifiedVerifiableCredentialToExisting(verifiableCredentialToSend, inputDescriptorId);
      }
    }
  }

  private copyMandatoryFieldsAndDeletePredefinedKeys(
    verifiableCredential: unknown,
    verifiableCredentialToSend: unknown,
    keys: string[]
  ): string[] {
    for (let i = 0; i < LimitDisclosureEvaluationHandler.mandatoryFields.length; i++) {
      verifiableCredentialToSend[LimitDisclosureEvaluationHandler.mandatoryFields[i]] =
        verifiableCredential[LimitDisclosureEvaluationHandler.mandatoryFields[i]];
      const index = keys.indexOf(LimitDisclosureEvaluationHandler.mandatoryFields[i]);
      if (index > -1) {
        keys.splice(index, 1);
      }
    }
    return keys;
  }

  private determineNecessaryPaths(vc: unknown, vcToSend: unknown, fields: Field[], idIdx: number, vcIdx: number) {
    for (let i = 0; i < fields.length; i++) {
      const field: Field = fields[i];
      const result = JsonPathUtils.extractInputField(vc, field.path);
      if (result.length > 0) {
        this.copyResultPathToDestinationCredential(result[0].path, vc, vcToSend, idIdx, vcIdx);
      } else {
        this.createMandatoryFieldNotFoundResult(idIdx, vcIdx, field.path);
      }
    }
  }

  private copyResultPathToDestinationCredential(
    pathDetails: any[],
    verifiableCredential: unknown,
    verifiableCredentialToSend: unknown,
    idIdx: number,
    vcIdx: number
  ) {
    let objectCursor = verifiableCredential;
    let currentCursorInToSendObj = verifiableCredentialToSend;
    this.createSuccessResult(idIdx, vcIdx, pathDetails);
    for (let i = 1; i < pathDetails.length; i++) {
      objectCursor = objectCursor[pathDetails[i]];
      if (pathDetails.length == i + 1) {
        currentCursorInToSendObj[pathDetails[i]] = objectCursor;
      } else if (typeof pathDetails[i] === 'string' && typeof pathDetails[i + 1] === 'string') {
        currentCursorInToSendObj[pathDetails[i]] = {};
        currentCursorInToSendObj = currentCursorInToSendObj[pathDetails[i]];
      } else if (typeof pathDetails[i] === 'string' && typeof pathDetails[i + 1] !== 'string') {
        currentCursorInToSendObj[pathDetails[i]] = [{}];
        currentCursorInToSendObj = currentCursorInToSendObj[pathDetails[i]];
      } else {
        currentCursorInToSendObj[pathDetails[i]] = {};
        currentCursorInToSendObj = currentCursorInToSendObj[pathDetails[i]];
      }
    }
  }

  private copyModifiedVerifiableCredentialToExisting(verifiableCredentialToSend: any, inputDescriptorId: string) {
    if (!this.verifiablePresentation.verifiableCredential) {
      this.verifiablePresentation.verifiableCredential = [];
    }
    for (let i = 0; i < this.verifiablePresentation.presentationSubmission.descriptor_map.length; i++) {
      const currentDescriptor: Descriptor = this.verifiablePresentation.presentationSubmission.descriptor_map[i];
      if (currentDescriptor.id === inputDescriptorId) {
        this.verifiablePresentation.verifiableCredential.push(verifiableCredentialToSend);
      }
    }
  }

  private createSuccessResult(idIdx: number, vcIdx: number, pathDetails: any[]) {
    return this.results.push({
      input_descriptor_path: `$.input_descriptors[${idIdx}]`,
      verifiable_credential_path: `$.verifiableCredential[${vcIdx}]`,
      evaluator: this.getName(),
      status: Status.INFO,
      message: 'added variable in the limit_disclosure to the verifiableCredential',
      payload: pathDetails,
    });
  }

  private createMandatoryFieldNotFoundResult(idIdx: number, vcIdx: number, path: Array<string>) {
    return this.results.push({
      input_descriptor_path: `$.input_descriptors[${idIdx}]`,
      verifiable_credential_path: `$.verifiableCredential[${vcIdx}]`,
      evaluator: this.getName(),
      status: Status.ERROR,
      message: 'mandatory field not present in the verifiableCredential',
      payload: path,
    });
  }
}
