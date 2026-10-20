#!/usr/bin/env python3
"""Builds the two iOS Shortcuts as signed .shortcut files.

    python3 shortcuts/build.py <webhook /exec URL>

Writes "Index That.shortcut" (Share Sheet) and "Index Thought.shortcut" (voice) next to this
script, signed with macOS `shortcuts sign`. Importing asks for your INGEST_KEY and fills it into
the second action ("PASTE YOUR KEY HERE" until then). The key never goes into these files.

lean: hand-built Shortcuts plist (an undocumented Apple format). If an action imports blank
after an iOS update, rebuild that step by hand from ios-shortcut-guide.md.
"""
import plistlib
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

KEY_PLACEHOLDER = 'PASTE YOUR KEY HERE'
OUT = Path(__file__).resolve().parent


def new_id():
    return str(uuid.uuid4()).upper()


def output(action_uuid, name):
    return {'OutputUUID': action_uuid, 'Type': 'ActionOutput', 'OutputName': name}


SHORTCUT_INPUT = {'Type': 'ExtensionInput'}
REPLY = {'Type': 'Variable', 'VariableName': 'Reply'}


def attachment(ref):
    return {'Value': ref, 'WFSerializationType': 'WFTextTokenAttachment'}


def text(value, ref=None, prefix=''):
    """Plain text, or prefix + one variable."""
    if ref is None:
        return {'Value': {'string': value, 'attachmentsByRange': {}}, 'WFSerializationType': 'WFTextTokenString'}
    return {
        'Value': {'string': prefix + '￼', 'attachmentsByRange': {f'{{{len(prefix)}, 1}}': ref}},
        'WFSerializationType': 'WFTextTokenString',
    }


def field(key, value):
    return {'WFItemType': 0, 'WFKey': text(key), 'WFValue': value}


def dict_field(key, items):
    return {
        'WFItemType': 1,
        'WFKey': text(key),
        'WFValue': {'Value': {'WFDictionaryFieldValueItems': items}, 'WFSerializationType': 'WFDictionaryFieldValue'},
    }


def action(identifier, **params):
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{identifier}', 'WFWorkflowActionParameters': params}


class Flow:
    """Collects actions; helpers return the UUID whose output later actions reference."""

    def __init__(self):
        self.actions = []

    def add(self, identifier, **params):
        params.setdefault('UUID', new_id())
        self.actions.append(action(identifier, **params))
        return params['UUID']

    def if_has_value(self, ref):
        group = new_id()
        self.actions.append(action('conditional', GroupingIdentifier=group, WFControlFlowMode=0, WFCondition=100,
                                   WFInput={'Type': 'Variable', 'Variable': attachment(ref)}))
        return group

    def otherwise(self, group):
        self.actions.append(action('conditional', GroupingIdentifier=group, WFControlFlowMode=1))

    def end_if(self, group):
        end = new_id()
        self.actions.append(action('conditional', GroupingIdentifier=group, WFControlFlowMode=2, UUID=end))
        return output(end, 'If Result')

    def post(self, url_ref, items):
        return self.add('downloadurl', WFURL=text('', url_ref), WFHTTPMethod='POST', WFHTTPBodyType='JSON',
                        WFJSONValues={'Value': {'WFDictionaryFieldValueItems': items},
                                      'WFSerializationType': 'WFDictionaryFieldValue'})

    def post_and_keep(self, url_ref, items):
        """POST, then store the reply in the named variable Reply. Nested If blocks don't pass
        a branch's output through reliably, so the confirmation reads this variable instead."""
        reply = self.post(url_ref, items)
        self.add('setvariable', WFVariableName='Reply', WFInput=attachment(output(reply, 'Contents of URL')))

    def confirm(self, reply_ref):
        """Notification: "Indexed [TAG]" when the reply has a tag, otherwise "Not saved: <error>"."""
        tag = self.add('getvalueforkey', WFGetDictionaryValueType='Value', WFDictionaryKey='tag',
                       WFInput=attachment(reply_ref))
        group = self.if_has_value(output(tag, 'Dictionary Value'))
        self.add('notification', WFNotificationActionTitle=text('Index That'),
                 WFNotificationActionBody=text('', output(tag, 'Dictionary Value'), 'Indexed '))
        self.otherwise(group)
        err = self.add('getvalueforkey', WFGetDictionaryValueType='Value', WFDictionaryKey='error',
                       WFInput=attachment(reply_ref))
        self.add('notification', WFNotificationActionTitle=text('Index That'),
                 WFNotificationActionBody=text('', output(err, 'Dictionary Value'), 'Not saved: '))
        self.end_if(group)


def settings(flow, webhook):
    url = flow.add('gettext', WFTextActionText=text(webhook))
    key = flow.add('gettext', WFTextActionText=text(KEY_PLACEHOLDER))
    return output(url, 'Text'), output(key, 'Text')


def share_sheet(webhook):
    f = Flow()
    url, key = settings(f, webhook)
    common = [field('source', text('share-sheet')), field('key', text('', key))]

    # Links first: on a Safari page, "Get Images from Input" would grab the page's pictures instead.
    urls = f.add('detect.link', WFInput=attachment(SHORTCUT_INPUT))
    links = f.if_has_value(output(urls, 'URLs'))
    first_url = f.add('getitemfromlist', WFItemSpecifier='First Item', WFInput=attachment(output(urls, 'URLs')))
    name = f.add('getitemname', WFInput=attachment(SHORTCUT_INPUT))
    f.post_and_keep(url, [field('type', text('url')),
                 field('url', text('', output(first_url, 'Item from List'))),
                 field('title', text('', output(name, 'Name'))),
                 field('text', text('', SHORTCUT_INPUT))] + common)
    f.otherwise(links)

    # Text before images: Shortcuts will happily render shared text into a picture of the text.
    # "ext" matches both "Text" and "Rich text" type names.
    kind = f.add('getitemtype', WFInput=attachment(SHORTCUT_INPUT))
    is_text = new_id()
    f.actions.append(action('conditional', GroupingIdentifier=is_text, WFControlFlowMode=0, WFCondition=99,
                            WFConditionalActionString='ext',
                            WFInput={'Type': 'Variable', 'Variable': attachment(output(kind, 'Type'))}))
    f.post_and_keep(url, [field('type', text('text')), field('text', text('', SHORTCUT_INPUT))] + common)
    f.otherwise(is_text)

    images = f.add('detect.images', WFInput=attachment(SHORTCUT_INPUT))
    pics = f.if_has_value(output(images, 'Images'))
    first_img = f.add('getitemfromlist', WFItemSpecifier='First Item', WFInput=attachment(output(images, 'Images')))
    resized = f.add('image.resize', WFImageResizeKey='Longest Edge', WFImageResizeLength='1600',
                    WFImage=attachment(output(first_img, 'Item from List')))
    jpeg = f.add('image.convert', WFImageFormat='JPEG', WFImageCompressionQuality=0.8, WFImagePreserveMetadata=False,
                 WFInput=attachment(output(resized, 'Resized Image')))
    b64 = f.add('base64encode', WFEncodeMode='Encode', WFBase64LineBreakMode='None',
                WFInput=attachment(output(jpeg, 'Converted Image')))
    f.post_and_keep(url, [field('type', text('image')),
                 dict_field('image', [field('data', text('', output(b64, 'Base64 Encoded'))),
                                      field('mimeType', text('image/jpeg'))])] + common)
    f.otherwise(pics)

    f.post_and_keep(url, [field('type', text('text')), field('text', text('', SHORTCUT_INPUT))] + common)
    f.end_if(pics)
    f.end_if(is_text)
    f.end_if(links)

    f.confirm(REPLY)
    return workflow(f, share=True)


def voice(webhook):
    f = Flow()
    url, key = settings(f, webhook)
    spoken = f.add('dictatetext', WFDictateTextStopListening='After Pause')
    said = f.if_has_value(output(spoken, 'Dictated Text'))
    reply = f.post(url, [field('type', text('text')),
                         field('text', text('', output(spoken, 'Dictated Text'))),
                         field('source', text('dictation')),
                         field('key', text('', key))])
    f.confirm(output(reply, 'Contents of URL'))
    f.end_if(said)
    return workflow(f, share=False)


def workflow(flow, share):
    data = {
        'WFWorkflowActions': flow.actions,
        'WFWorkflowClientVersion': '2600.0.0',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
        # Import asks for the key and fills the second action (index 1), so it is never stored in these files.
        'WFWorkflowImportQuestions': [{
            'ActionIndex': 1,
            'Category': 'Parameter',
            'ParameterKey': 'WFTextActionText',
            'Text': 'Paste your Index That key (INGEST_KEY)',
            'DefaultValue': '',
        }],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': ['ActionExtension'] if share else [],
        'WFWorkflowInputContentItemClasses': (
            ['WFURLContentItem', 'WFSafariWebPageContentItem', 'WFImageContentItem', 'WFStringContentItem']
            if share else []),
        'WFWorkflowHasShortcutInputVariables': share,
    }
    return data


def sign(data, name):
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = Path(tmp) / 'unsigned.shortcut'
        unsigned.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY))
        out = OUT / f'{name}.shortcut'
        subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', str(unsigned), '--output', str(out)],
                       check=True)
        return out


def main():
    if len(sys.argv) != 2 or not sys.argv[1].startswith('https://script.google.com/') or not sys.argv[1].endswith('/exec'):
        sys.exit('usage: build.py https://script.google.com/macros/s/<id>/exec')
    webhook = sys.argv[1]
    for name, data in (('Index That', share_sheet(webhook)), ('Index Thought', voice(webhook))):
        print('signed', sign(data, name))


if __name__ == '__main__':
    main()
