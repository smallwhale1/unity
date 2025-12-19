/* eslint-disable class-methods-use-this */

import { createTag, getConfig, unityConfig } from '../../../scripts/utils.js';

export default class UnityWidget {
  constructor(target, el, workflowCfg, spriteCon) {
    this.el = el;
    this.target = target;
    this.workflowCfg = workflowCfg;
    this.widget = null;
    this.actionMap = {};
    this.spriteCon = spriteCon;
    this.prompts = null;
    this.models = null;
    this.selectedVerbType = '';
    this.selectedVerbText = '';
    this.selectedModelModule = '';
    this.selectedModelId = '';
    this.selectedModelText = '';
    this.selectedModelVersion = '';
    this.promptItems = [];
    this.genBtn = null;
    this.hasPromptSuggestions = false;
    this.hasModelOptions = false;
    this.lanaOptions = { sampleRate: 100, tags: 'Unity-FF' };
    this.sound = { audio: null, currentTile: null, currentUrl: '' };
    this.durationCache = new Map();
  }

  async initWidget() {
    const [widgetWrap, widget] = ['ex-unity-wrap', 'ex-unity-widget'].map((c) =>
      createTag('div', { class: c })
    );
    this.widgetWrap = widgetWrap;
    this.widget = widget;

    // if (window.customElements && window.customElements.get('firefly-prompt-bar-app')) {
    // Use CDN widget
    const args = {
      // Add configuration here if needed
      // host: { /* ... */ },
      // persistName: 'unity-prompt-bar',
      // environment: { /* ... */ },
      // features: { /* ... */ },
    };

    const promptBarHTML = [
      '<sp-theme theme="light" scale="medium"><firefly-prompt-bar-app',
      args.host !== undefined ? ` host='${JSON.stringify(args.host)}'` : '',
      args.persistName !== undefined
        ? ` persistName="${args.persistName}"`
        : '',
      args.environment !== undefined
        ? ` environment='${JSON.stringify(args.environment)}'`
        : '',
      args.features !== undefined
        ? ` features='${JSON.stringify(args.features)}'`
        : '',
      '></firefly-prompt-bar-app></sp-theme>',
    ].join('');

    this.widget.innerHTML = promptBarHTML;
    this.addWidget();
    if (this.workflowCfg.targetCfg.floatPrompt) this.initIO();
    return this.workflowCfg.targetCfg.actionMap;
    // }

    // Fallback to existing custom widget
    const unitySprite = createTag('div', { class: 'unity-sprite-container' });
    unitySprite.innerHTML = this.spriteCon;
    this.widgetWrap.append(unitySprite);
    this.workflowCfg.placeholder = this.popPlaceholders();
    const hasPromptPlaceholder = !!this.el.querySelector(
      '.icon-placeholder-prompt'
    );
    const hasSuggestionsPlaceholder = !!this.el.querySelector(
      '.icon-placeholder-suggestions'
    );
    const hasModels = !!this.el.querySelector('[class*="icon-model"]');
    this.hasModelOptions = hasModels;
    this.hasPromptSuggestions =
      hasPromptPlaceholder && hasSuggestionsPlaceholder;
    if (this.hasModelOptions) await this.getModel();
    const inputWrapper = this.createInpWrap(this.workflowCfg.placeholder);
    await this.ensureSoundModuleLoaded();
    let dropdown = null;
    if (this.hasPromptSuggestions)
      dropdown = await this.genDropdown(this.workflowCfg.placeholder);
    const comboboxContainer = createTag('div', { class: 'autocomplete' });
    comboboxContainer.append(inputWrapper);
    if (dropdown) comboboxContainer.append(dropdown);
    this.widget.append(comboboxContainer);
    this.addWidget();
    if (this.workflowCfg.targetCfg.floatPrompt) this.initIO();
    return this.workflowCfg.targetCfg.actionMap;
  }

  async ensureSoundModuleLoaded() {
    if (this.selectedVerbType !== 'sound' || this.soundAugmented) return;
    try {
      const { default: augmentSound } = await import('./sound-utils.js');
      augmentSound(this);
      this.soundAugmented = true;
    } catch (e) {
      window.lana?.log(
        `Message: Error loading sound module, Error: ${e}`,
        this.lanaOptions
      );
    }
  }

  popPlaceholders() {
    return Object.fromEntries(
      [...this.el.querySelectorAll('[class*="placeholder"]')]
        .map((element) => [
          element.classList[1]?.replace('icon-', '') || '',
          element.closest('li')?.innerText || '',
        ])
        .filter(([key]) => key)
    );
  }

  showVerbMenu(selectedElement) {
    const menuContainer = selectedElement.parentElement;
    document.querySelectorAll('.verbs-container').forEach((container) => {
      if (container !== menuContainer) {
        container.classList.remove('show-menu');
        container
          .querySelector('.selected-verb')
          ?.setAttribute('aria-expanded', 'false');
      }
    });
    menuContainer.classList.toggle('show-menu');
    selectedElement.setAttribute(
      'aria-expanded',
      menuContainer.classList.contains('show-menu') ? 'true' : 'false'
    );
    if (selectedElement.nextElementSibling.hasAttribute('style'))
      selectedElement.nextElementSibling.removeAttribute('style');
  }

  hidePromptDropdown(exceptElement = null) {
    const dropdown = this.widget.querySelector('.prompt-dropdown-container');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
      dropdown.setAttribute('inert', '');
      dropdown.setAttribute('aria-hidden', 'true');
    }
    if (this.selectedVerbType === 'sound') {
      this.resetAllSoundVariations?.(dropdown);
    }
    const modelDropdown = this.widget.querySelector('.models-container');
    const modelButton = modelDropdown?.querySelector('.selected-model');
    if (
      modelDropdown &&
      modelDropdown.classList.contains('show-menu') &&
      modelButton !== exceptElement
    ) {
      modelDropdown.classList.remove('show-menu');
      modelButton?.setAttribute('aria-expanded', 'false');
    }
    const verbDropdown = this.widget.querySelector('.verbs-container');
    const verbButton = verbDropdown?.querySelector('.selected-verb');
    if (
      verbDropdown &&
      verbDropdown.classList.contains('show-menu') &&
      verbButton !== exceptElement
    ) {
      verbDropdown.classList.remove('show-menu');
      verbButton?.setAttribute('aria-expanded', 'false');
    }
  }

  updateAnalytics(verb) {
    if (this.promptItems && this.promptItems.length > 0) {
      this.promptItems.forEach((item) => {
        const ariaLabel = item.getAttribute('aria-label') || '';
        item.setAttribute(
          'daa-ll',
          `${ariaLabel.slice(0, 20)}--${verb}--Prompt suggestion`
        );
      });
    }
    if (this.genBtn) {
      this.genBtn.setAttribute('daa-ll', `Generate--${verb}`);
    }
  }

  clearSelectedModelState() {
    this.selectedModelId = '';
    this.selectedModelVersion = '';
    this.selectedModelModule = '';
    this.selectedModelText = '';
  }

  handleVerbLinkClick(
    link,
    verbList,
    selectedElement,
    menuIcon,
    inputPlaceHolder,
    modelList
  ) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      const verbLinkTexts = [];
      verbList.querySelectorAll('.verb-link').forEach((listLink) => {
        listLink.parentElement.classList.remove('selected');
        listLink.setAttribute('aria-selected', 'false');
        const text = listLink.textContent.trim();
        if (text) verbLinkTexts.push(text);
      });
      verbLinkTexts.sort((a, b) => b.length - a.length);
      selectedElement.parentElement.classList.toggle('show-menu');
      selectedElement.setAttribute(
        'aria-expanded',
        selectedElement.parentElement.classList.contains('show-menu')
          ? 'true'
          : 'false'
      );
      link.parentElement.classList.add('selected');
      link.setAttribute('aria-selected', 'true');
      if (modelList) {
        this.selectedModelId = link.getAttribute('data-model-id');
        this.selectedModelVersion = link.getAttribute('data-model-version');
        this.selectedModelModule = link.getAttribute('data-model-module');
        this.selectedModelText = link.textContent.trim();
        const copiedNodes = link.cloneNode(true).childNodes;
        copiedNodes[0].remove();
        selectedElement.replaceChildren(...copiedNodes, menuIcon);
        selectedElement.dataset.selectedModelId = this.selectedModelId;
        selectedElement.dataset.selectedModelVersion =
          this.selectedModelVersion;
      } else {
        this.selectedVerbType = link.getAttribute('data-verb-type');
        this.selectedVerbText = link.textContent.trim();
        selectedElement.replaceChildren(this.selectedVerbText, menuIcon);
        selectedElement.dataset.selectedVerb = this.selectedVerbType;
      }
      selectedElement.focus();
      this.ensureSoundModuleLoaded();
      const verbsWithoutPromptSuggestions =
        this.workflowCfg.targetCfg?.verbsWithoutPromptSuggestions ?? [];
      if (!verbsWithoutPromptSuggestions.includes(this.selectedVerbType))
        this.updateDropdownForVerb(this.selectedVerbType);
      else
        this.widgetWrap.dispatchEvent(
          new CustomEvent('firefly-reinit-action-listeners')
        );
      if (link.getAttribute('data-model-module') !== this.selectedVerbType) {
        const oldModelContainer =
          this.widget.querySelector('.models-container');
        const modelDropdown = this.modelDropdown();
        if (oldModelContainer) {
          if (modelDropdown.length > 1) {
            const newModelContainer = createTag('div', {
              class: 'models-container',
              'aria-label': 'Model options',
            });
            newModelContainer.append(...modelDropdown);
            oldModelContainer.replaceWith(newModelContainer);
          } else {
            oldModelContainer.remove();
            this.clearSelectedModelState();
          }
        } else if (modelDropdown.length > 1) {
          const actionContainer =
            this.widget.querySelector('.action-container');
          if (actionContainer) {
            const newModelContainer = createTag('div', {
              class: 'models-container',
              'aria-label': 'Prompt options',
            });
            newModelContainer.append(...modelDropdown);
            actionContainer.append(newModelContainer);
          }
        } else this.clearSelectedModelState();
      }
      this.widgetWrap.setAttribute('data-selected-verb', this.selectedVerbType);
      if (this.selectedModelId)
        this.widgetWrap.setAttribute(
          'data-selected-model-id',
          this.selectedModelId
        );
      else this.widgetWrap.removeAttribute('data-selected-model-id');
      if (this.selectedModelVersion)
        this.widgetWrap.setAttribute(
          'data-selected-model-version',
          this.selectedModelVersion
        );
      else this.widgetWrap.removeAttribute('data-selected-model-version');
      this.updateAnalytics(this.selectedVerbType);
      if (this.genBtn) {
        const img = this.genBtn.querySelector('img[src*=".svg"]');
        this.genBtn.setAttribute(
          'aria-label',
          (this.genBtn.getAttribute('aria-label') || '').replace(
            new RegExp(`\\b(${verbLinkTexts.join('|')})\\b`),
            this.selectedVerbText
          )
        );
        if (img)
          img.setAttribute(
            'alt',
            `${this.genBtn.getAttribute('aria-label') || ''}`
          );
      }
    };
  }

  createDropdownItems(
    items,
    listContainer,
    selectedElement,
    menuIcon,
    inputPlaceHolder,
    isModelList
  ) {
    const fragment = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const { name, type, icon, module, id, version } = item;
      const listItem = createTag('li', {
        class: 'verb-item',
        role: 'presentation',
      });
      const selectedIcon = createTag(
        'span',
        { class: 'selected-icon' },
        '<svg><use xlink:href="#unity-checkmark-icon"></use></svg>'
      );
      const nameContainer =
        isModelList && createTag('span', { class: 'model-name' }, name.trim());
      const link = createTag(
        'a',
        {
          href: '#',
          class: isModelList ? 'verb-link model-link' : 'verb-link',
          ...(!isModelList && { 'data-verb-type': type }),
          ...(isModelList && { 'data-model-module': module }),
          ...(isModelList && { 'data-model-id': id }),
          ...(isModelList && { 'data-model-version': version }),
          'aria-selected': 'false',
          role: 'option',
        },
        `<img loading="lazy" src="${icon}" alt="" />${
          nameContainer ? nameContainer.outerHTML : name
        }`
      );
      if (idx === 0) {
        listItem.classList.add('selected');
        link.setAttribute('aria-selected', 'true');
      }
      link.prepend(selectedIcon);
      listItem.append(link);
      fragment.append(listItem);
    });
    listContainer.append(fragment);
    listContainer.addEventListener('click', (e) => {
      const link = e.target.closest('.verb-link');
      if (!link) return;
      this.handleVerbLinkClick(
        link,
        listContainer,
        selectedElement,
        menuIcon,
        inputPlaceHolder,
        isModelList
      )(e);
    });
  }

  verbDropdown() {
    const verbs = this.el.querySelectorAll('[class*="icon-verb"]');
    const inputPlaceHolder = this.el.querySelector('.icon-placeholder-input')
      .parentElement.textContent;
    const selectedVerbType = verbs[0]?.className.split('-')[2];
    const selectedVerb = verbs[0]?.nextElementSibling;
    const selectedElement = createTag(
      'button',
      {
        class: 'selected-verb',
        'aria-expanded': 'false',
        'aria-controls': 'media-menu',
        'aria-label': 'media type',
        'aria-haspopup': 'listbox',
        role: 'combobox',
        'aria-labelledby': 'listbox-label',
        'data-selected-verb': selectedVerbType,
      },
      `${selectedVerb?.textContent.trim()}`
    );
    this.selectedVerbType = selectedVerbType;
    this.widgetWrap.setAttribute('data-selected-verb', this.selectedVerbType);
    this.selectedVerbText = selectedVerb?.textContent.trim();
    if (verbs.length <= 1) {
      selectedElement.setAttribute('disabled', 'true');
      return [selectedElement];
    }
    this.widgetWrap.classList.add('verb-options');
    const menuIcon = createTag(
      'span',
      { class: 'menu-icon' },
      '<svg><use xlink:href="#unity-chevron-icon"></use></svg>'
    );
    const verbList = createTag('ul', {
      class: 'verb-list',
      id: 'media-menu',
      role: 'listbox',
      'aria-labelledby': 'listbox-label',
    });
    verbList.setAttribute('style', 'display: none;');
    selectedElement.append(menuIcon);
    const handleDocumentClick = (e) => {
      const menuContainer = selectedElement.parentElement;
      if (!menuContainer.contains(e.target)) {
        document.removeEventListener('click', handleDocumentClick);
        menuContainer.classList.remove('show-menu');
        selectedElement.setAttribute('aria-expanded', 'false');
      }
    };
    selectedElement.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        this.hidePromptDropdown(selectedElement);
        this.showVerbMenu(selectedElement);
        document.addEventListener('click', handleDocumentClick);
      },
      true
    );
    selectedElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        this.hidePromptDropdown(selectedElement);
        this.showVerbMenu(selectedElement);
      }
      if (e.key === 'Escape' || e.code === 27) {
        selectedElement.parentElement.classList?.remove('show-menu');
        selectedElement.focus();
      }
    });
    verbs[0]?.classList.add('selected');
    const verbsData = Array.from(verbs).map((verb) => ({
      name: verb.nextElementSibling?.textContent.trim(),
      type: verb.classList[1].split('-')[2],
      icon: verb.nextElementSibling?.href,
    }));
    this.createDropdownItems(
      verbsData,
      verbList,
      selectedElement,
      menuIcon,
      inputPlaceHolder,
      false
    );
    return [selectedElement, verbList];
  }

  modelDropdown() {
    if (!this.hasModelOptions) return [];
    const models = this.models.filter(
      (obj) => obj.module === this.selectedVerbType
    );
    if (!Array.isArray(models) || models.length === 0) return [];
    const inputPlaceHolder = this.el.querySelector('.icon-placeholder-input')
      .parentElement.textContent;
    const selectedModelType = models[0].id;
    const selectedModelVersion = models[0].version;
    const selectedModelModule = models[0].module;
    const nameContainer = createTag(
      'span',
      { class: 'model-name' },
      models[0].name.trim()
    );
    const selectedElement = createTag(
      'button',
      {
        class: 'selected-model',
        'aria-expanded': 'false',
        'aria-controls': 'model-menu',
        'aria-label': 'model type',
        'aria-haspopup': 'listbox',
        role: 'combobox',
        'aria-labelledby': 'listbox-label',
        'data-selected-model-id': selectedModelType,
        'data-selected-model-version': selectedModelVersion,
        'data-selected-model-module': selectedModelModule,
      },
      `<img src="${models[0].icon}" alt="" />${nameContainer.outerHTML}`
    );
    this.selectedModelModule = selectedModelModule;
    this.selectedModelId = selectedModelType;
    this.selectedModelVersion = selectedModelVersion;
    this.widgetWrap.setAttribute(
      'data-selected-model-id',
      this.selectedModelId
    );
    this.widgetWrap.setAttribute(
      'data-selected-model-version',
      this.selectedModelVersion
    );
    this.widgetWrap.setAttribute('data-selected-verb', this.selectedVerbType);
    this.selectedModelText = models[0].name.trim();
    const menuIcon = createTag(
      'span',
      { class: 'menu-icon' },
      '<svg><use xlink:href="#unity-chevron-icon"></use></svg>'
    );
    const listItems = createTag('ul', {
      class: 'verb-list',
      id: 'model-menu',
      role: 'listbox',
      'aria-labelledby': 'listbox-label',
    });
    listItems.setAttribute('style', 'display: none;');
    selectedElement.append(menuIcon);
    const handleDocumentClick = (e) => {
      const menuContainer = selectedElement.parentElement;
      if (!menuContainer.contains(e.target)) {
        document.removeEventListener('click', handleDocumentClick);
        menuContainer.classList.remove('show-menu');
        selectedElement.setAttribute('aria-expanded', 'false');
      }
    };
    selectedElement.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        this.hidePromptDropdown(selectedElement);
        this.showVerbMenu(selectedElement);
        document.addEventListener('click', handleDocumentClick);
      },
      true
    );
    selectedElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        this.hidePromptDropdown(selectedElement);
        this.showVerbMenu(selectedElement);
      }
      if (e.key === 'Escape' || e.code === 27) {
        selectedElement.parentElement.classList?.remove('show-menu');
        selectedElement.focus();
      }
    });
    this.createDropdownItems(
      models,
      listItems,
      selectedElement,
      menuIcon,
      inputPlaceHolder,
      true
    );
    return [selectedElement, listItems];
  }

  createInpWrap(ph) {
    const inpWrap = createTag('div', { class: 'inp-wrap' });
    const actWrap = createTag('div', { class: 'act-wrap' });
    const inpField = createTag('textarea', {
      id: 'promptInput',
      class: 'inp-field',
      type: 'text',
      placeholder: ph['placeholder-input'],
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-controls': 'prompt-dropdown',
      'aria-activedescendant': '',
    });
    const dropdown = this.widget.querySelector('.prompt-dropdown-container');
    inpField.addEventListener('focus', () => this.hidePromptDropdown());
    inpField.addEventListener('click', () =>
      this.resetAllSoundVariations?.(dropdown)
    );
    inpField.addEventListener('input', () =>
      this.resetAllSoundVariations?.(dropdown)
    );
    const verbDropdown = this.verbDropdown();
    const modelDropdown = this.modelDropdown();
    const genBtn = this.createActBtn(
      this.el.querySelector('.icon-generate')?.closest('li'),
      'gen-btn'
    );
    actWrap.append(genBtn);
    const actionContainer = createTag('div', { class: 'action-container' });
    const hasPromptLabel = this.el.querySelector(
      '.icon-placeholder-prompt-label'
    );
    if (hasPromptLabel && ph['placeholder-prompt-label']) {
      const promptLabel = createTag(
        'label',
        { for: 'promptInput', class: 'inp-field-label' },
        ph['placeholder-prompt-label']
      );
      inpWrap.appendChild(promptLabel);
    }
    if (verbDropdown.length > 1) {
      const verbBtn = createTag('div', {
        class: 'verbs-container',
        'aria-label': 'Media options',
      });
      verbBtn.append(...verbDropdown);
      actionContainer.append(verbBtn);
      inpWrap.append(inpField, actionContainer, actWrap);
    } else {
      inpWrap.append(inpField, actWrap);
    }
    if (modelDropdown.length > 1) {
      const modelBtn = createTag('div', {
        class: 'models-container',
        'aria-label': 'Model options',
      });
      modelBtn.append(...modelDropdown);
      actionContainer.append(modelBtn);
    }
    return inpWrap;
  }

  getLimitedDisplayPrompts(prompts) {
    const shuffled = prompts.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3).map(({ prompt, assetid, variations }) => ({
      prompt,
      assetid,
      variations,
    }));
  }

  addPromptItemsToDropdown(dropdown, prompts, placeholder) {
    this.promptItems = [];
    prompts.forEach(({ prompt, assetid, variations }, idx) => {
      const item = createTag('li', {
        id: assetid,
        class: 'drop-item',
        role: 'option',
        tabindex: '0',
        'aria-label': prompt,
        'aria-description': `${placeholder['placeholder-prompt']} ${placeholder['placeholder-suggestions']}`,
        'daa-ll': `${prompt.slice(0, 20)}--${
          this.selectedVerbType
        }--Prompt suggestion`,
      });
      const iconWrap = createTag(
        'span',
        { class: 'prompt-icon' },
        '<svg><use xlink:href="#unity-prompt-icon"></use></svg>'
      );
      const text = createTag('span', { class: 'drop-text' }, prompt);
      item.append(iconWrap, text);
      dropdown.append(item);
      this.promptItems.push(item);

      if (this.selectedVerbType === 'sound')
        this.addSoundSuggestionHandlers(
          dropdown,
          item,
          { prompt, variations },
          idx + 1
        );
    });
  }

  async genDropdown(ph) {
    if (!this.hasPromptSuggestions) return null;
    const promptDropdownContainer = createTag('div', {
      class: 'prompt-dropdown-container drop hidden',
      'aria-hidden': 'true',
    });
    const dd = createTag('ul', {
      id: 'prompt-dropdown',
      class: 'prompt-suggestions-list',
      'daa-lh': 'Marquee',
      role: 'listbox',
      'aria-labelledby': 'promptInput',
    });
    const titleCon = createTag('div', { class: 'drop-title-con' });
    const title = createTag(
      'span',
      { class: 'drop-title', id: 'prompt-suggestions' },
      `${ph['placeholder-prompt']} ${ph['placeholder-suggestions']}`
    );
    titleCon.append(title);
    const prompts = await this.getPrompt(this.selectedVerbType);
    const limited = this.getLimitedDisplayPrompts(prompts);
    this.addPromptItemsToDropdown(dd, limited, ph);
    promptDropdownContainer.append(titleCon, dd, this.createFooter(ph));
    if (!this.outsideDropdownHandler) {
      this.outsideDropdownHandler = (ev) => {
        if (
          this.widgetWrap &&
          window.getComputedStyle(this.widgetWrap).pointerEvents === 'none'
        )
          return;
        const wrapper = this.widget.querySelector('.autocomplete');
        if (wrapper && wrapper.contains(ev.target)) return;
        if (
          promptDropdownContainer &&
          !promptDropdownContainer.classList.contains('hidden') &&
          !promptDropdownContainer.contains(ev.target)
        ) {
          this.hidePromptDropdown();
        }
      };
      setTimeout(
        () =>
          document.addEventListener('click', this.outsideDropdownHandler, true),
        0
      );
    }
    return promptDropdownContainer;
  }

  createFooter(ph) {
    const footer = createTag('div', { class: 'drop-footer' });
    const tipEl = this.el.querySelector('.icon-tip')?.closest('li');
    const tipCon = createTag(
      'div',
      {
        id: 'tip-content',
        class: 'tip-con',
        tabindex: '-1',
        role: 'note',
        'aria-label': `${ph['placeholder-tip']} ${tipEl?.innerText}`,
      },
      '<svg><use xlink:href="#unity-info-icon"></use></svg>'
    );
    const tipText = createTag(
      'span',
      { class: 'tip-text', id: 'tip-text' },
      `${ph['placeholder-tip']}:`
    );
    const tipDesc = createTag(
      'span',
      { class: 'tip-desc', id: 'tip-desc' },
      tipEl?.innerText || ''
    );
    tipCon.append(tipText, tipDesc);
    const legalEl = this.el.querySelector('.icon-legal')?.closest('li');
    const legalCon = createTag('div', { class: 'legal-con' });
    const legalLink = legalEl?.querySelector('a');
    const legalText = createTag(
      'a',
      { href: legalLink?.href || '#', class: 'legal-text' },
      legalLink?.innerText || 'Legal'
    );
    legalCon.append(legalText);
    footer.append(tipCon, legalCon);
    return footer;
  }

  createActBtn(cfg, cls) {
    if (!cfg) return null;
    const txt = cfg.innerText?.trim();
    const img = cfg.querySelector('img[src*=".svg"]');
    if (img)
      img.setAttribute(
        'alt',
        `${txt?.split('\n')[0]} ${this.selectedVerbText}`
      );
    const btn = createTag('a', {
      href: '#',
      class: `unity-act-btn ${cls}`,
      'daa-ll': `Generate--${this.selectedVerbType}`,
      'aria-label': `${txt?.split('\n')[0]} ${this.selectedVerbText}`,
    });
    if (img) btn.append(createTag('div', { class: 'btn-ico' }, img));
    if (txt)
      btn.append(createTag('div', { class: 'btn-txt' }, txt.split('\n')[0]));
    this.genBtn = btn;
    return btn;
  }

  addWidget() {
    const interactArea = this.target.querySelector('.copy');
    const para = interactArea?.querySelector(this.workflowCfg.targetCfg.target);
    this.widgetWrap.append(this.widget);
    if (para && this.workflowCfg.targetCfg.insert === 'before')
      para.before(this.widgetWrap);
    else if (para) para.after(this.widgetWrap);
    else interactArea?.appendChild(this.widgetWrap);
  }

  async loadPrompts() {
    const { locale } = getConfig();
    const { origin } = window.location;
    const baseUrl =
      origin.includes('.aem.') || origin.includes('.hlx.')
        ? `https://main--unity--adobecom.${
            origin.includes('.hlx.') ? 'hlx' : 'aem'
          }.live`
        : origin;
    const promptFile =
      locale.prefix && locale.prefix !== '/'
        ? `${baseUrl}${locale.prefix}/unity/configs/prompt/firefly-prompt.json`
        : `${baseUrl}/unity/configs/prompt/firefly-prompt.json`;
    const promptRes = await fetch(promptFile);
    if (!promptRes.ok) {
      throw new Error('Failed to fetch prompts.');
    }
    const promptJson = await promptRes.json();
    this.prompts = this.createPromptMap(promptJson?.content?.data);
  }

  async getPrompt(verb) {
    if (!this.hasPromptSuggestions) return [];
    try {
      if (!this.prompts || Object.keys(this.prompts).length === 0)
        await this.loadPrompts();
      return (this.prompts?.[verb] || []).filter(
        (item) => item.prompt && item.prompt.trim() !== ''
      );
    } catch (e) {
      window.lana?.log(
        `Message: Error loading promts, Error: ${e}`,
        this.lanaOptions
      );
      return [];
    }
  }

  async loadModels() {
    const { origin } = window.location;
    const baseUrl =
      origin.includes('.aem.') || origin.includes('.hlx.')
        ? `https://main--unity--adobecom.${
            origin.includes('.hlx.') ? 'hlx' : 'aem'
          }.live`
        : origin;
    const modelFile = `${baseUrl}/unity/configs/prompt/model-picker.json`;
    const results = await fetch(modelFile);
    if (!results.ok) {
      throw new Error('Failed to fetch models.');
    }
    const modelJson = await results.json();
    this.models = modelJson?.content?.data;
  }

  async getModel() {
    if (!this.hasModelOptions) return [];
    try {
      if (!this.models || Object.keys(this.models).length === 0)
        await this.loadModels();
      return this.models;
    } catch (e) {
      window.lana?.log(
        `Message: Error loading models, Error: ${e}`,
        this.lanaOptions
      );
      return [];
    }
  }

  createPromptMap(data) {
    const promptMap = {};
    if (Array.isArray(data)) {
      data.forEach((item) => {
        const itemEnv = item.env || 'prod';
        if (item.verb && item.prompt && itemEnv === unityConfig.env) {
          if (!promptMap[item.verb]) promptMap[item.verb] = [];
          let variations = [];
          if (item.verb === 'sound') {
            const ph = this.workflowCfg?.placeholder || {};
            const labels = Object.keys(ph)
              .filter((k) => k.startsWith('placeholder-variation-label-'))
              .map((k) => ({
                idx: Number.parseInt(k.split('-').pop(), 10),
                val: (ph[k] || '').trim(),
              }))
              .filter(({ idx, val }) => Number.isFinite(idx) && val)
              .sort((a, b) => a.idx - b.idx)
              .map(({ val }) => val);
            const urls = (
              typeof item.variationUrls === 'string' ? item.variationUrls : ''
            )
              .split('||')
              .map((s) => s.trim())
              .filter((s) => s);
            variations = labels.map((lbl, idx) => ({
              label: lbl,
              url: urls[idx] || '',
            }));
          }
          promptMap[item.verb].push({
            prompt: item.prompt,
            assetid: item.assetid,
            variations,
          });
        }
      });
    }
    return promptMap;
  }

  createModelMap(data) {
    const modelMap = {};
    if (Array.isArray(data)) {
      data.forEach((item) => {
        if (item.type) {
          if (!modelMap[item.module]) modelMap[item.module] = [];
          modelMap[item.module].push({
            name: item.name,
            id: item.id,
            version: item.version,
            icon: item.icon,
          });
        }
      });
    }
    return modelMap;
  }

  async updateDropdownForVerb(verb) {
    if (!this.hasPromptSuggestions) return;
    await this.ensureSoundModuleLoaded();
    const dropdown = this.widget.querySelector('#prompt-dropdown');
    if (!dropdown) return;
    dropdown.querySelectorAll('.drop-item').forEach((item) => item.remove());
    const prompts = await this.getPrompt(verb);
    const limited = this.getLimitedDisplayPrompts(prompts);
    this.addPromptItemsToDropdown(
      dropdown,
      limited,
      this.workflowCfg.placeholder
    );
    this.widgetWrap.dispatchEvent(
      new CustomEvent('firefly-reinit-action-listeners')
    );
  }
}
