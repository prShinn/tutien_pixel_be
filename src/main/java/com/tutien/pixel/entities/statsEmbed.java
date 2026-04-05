package com.tutien.pixel.entities;

import jakarta.persistence.Embeddable;

@Embeddable
public class statsEmbed {
    private int str;
    private int agi;
    private int vit;
    private int ene;

    public int getStr() {
        return str;
    }

    public void setStr(int str) {
        this.str = str;
    }

    public int getAgi() {
        return agi;
    }

    public void setAgi(int agi) {
        this.agi = agi;
    }

    public int getVit() {
        return vit;
    }

    public void setVit(int vit) {
        this.vit = vit;
    }

    public int getEne() {
        return ene;
    }

    public void setEne(int ene) {
        this.ene = ene;
    }
}
