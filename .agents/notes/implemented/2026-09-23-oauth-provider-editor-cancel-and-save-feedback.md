# OAuth provider editor cancel and save feedback

- date: 2026-09-23
- status: implemented
- scope: packages/dsh-next-oauth-providers

Cancel now closes the Add-provider editor and dismisses the Customized settings disclosure while discarding unsaved model edits. Applying provider settings closes the disclosure, refreshes the editor's model draft from the persisted RPC result, and shows a localized saved status; adding a provider also displays confirmation after closing the add flow. Client regressions cover cancellation, confirmation, and custom model visibility after reopening. The underlying issues were that the Add parent only handled `onChanged(true)`, while Cancel sends `false`, and the editor retained its pre-save model draft without success feedback.
