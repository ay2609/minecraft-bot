import type { ActionItem, CoreSkillName } from '../types';
import type { SkillExecutionOutcome, SkillHandler } from './types';

export const requiredSkillNames: CoreSkillName[] = [
  'move_to',
  'follow_entity',
  'place_block',
  'break_block',
  'craft_item',
  'drop_item',
  'equip_item',
  'interact_block',
  'attack_entity',
  'send_chat',
];

function notImplemented(skill: CoreSkillName): SkillHandler {
  return (actionItem: ActionItem): Promise<SkillExecutionOutcome> => {
    void actionItem;
    return Promise.resolve({
      success: false,
      errorCode: 'invalid_state',
      errorMessage: `${skill} is not implemented yet`,
      stateChanges: {},
    });
  };
}

const registry: Record<CoreSkillName, SkillHandler> = {
  move_to: notImplemented('move_to'),
  follow_entity: notImplemented('follow_entity'),
  place_block: notImplemented('place_block'),
  break_block: notImplemented('break_block'),
  craft_item: notImplemented('craft_item'),
  drop_item: notImplemented('drop_item'),
  equip_item: notImplemented('equip_item'),
  interact_block: notImplemented('interact_block'),
  attack_entity: notImplemented('attack_entity'),
  send_chat: notImplemented('send_chat'),
};

export function resolveSkill(skill: string): SkillHandler | null {
  return registry[skill as CoreSkillName] ?? null;
}
