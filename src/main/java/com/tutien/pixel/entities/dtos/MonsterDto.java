package com.tutien.pixel.entities.dtos;

import com.tutien.pixel.entities.vatPhamEntity;
import jakarta.persistence.Column;

import java.util.List;

public class MonsterDto {
    private int id;
    @Column(unique = true)
    private String code;
    private String name;
    private int level;
    private int hp;
    private int atk;
    private int def;
    private int speed;
    private int moneyDropTo;
    private int moneyDropFrom;
    private int tyLeRoiTien;
    private int tyLeRoiDo;
    private String color;
    private String sfx_name;
    private String sfxCode;
    private int spawnCD;
    private int isBoss;
    private int spawnX;
    private int spawnY;
    private String dropItem;
    private List<vatPhamEntity> dropItems;

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getLevel() {
        return level;
    }

    public void setLevel(int level) {
        this.level = level;
    }

    public int getHp() {
        return hp;
    }

    public void setHp(int hp) {
        this.hp = hp;
    }

    public int getAtk() {
        return atk;
    }

    public void setAtk(int atk) {
        this.atk = atk;
    }

    public int getDef() {
        return def;
    }

    public void setDef(int def) {
        this.def = def;
    }

    public int getSpeed() {
        return speed;
    }

    public void setSpeed(int speed) {
        this.speed = speed;
    }

    public int getMoneyDropTo() {
        return moneyDropTo;
    }

    public void setMoneyDropTo(int moneyDropTo) {
        this.moneyDropTo = moneyDropTo;
    }

    public int getMoneyDropFrom() {
        return moneyDropFrom;
    }

    public void setMoneyDropFrom(int moneyDropFrom) {
        this.moneyDropFrom = moneyDropFrom;
    }

    public int getTyLeRoiTien() {
        return tyLeRoiTien;
    }

    public void setTyLeRoiTien(int tyLeRoiTien) {
        this.tyLeRoiTien = tyLeRoiTien;
    }

    public int getTyLeRoiDo() {
        return tyLeRoiDo;
    }

    public void setTyLeRoiDo(int tyLeRoiDo) {
        this.tyLeRoiDo = tyLeRoiDo;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getSfx_name() {
        return sfx_name;
    }

    public void setSfx_name(String sfx_name) {
        this.sfx_name = sfx_name;
    }

    public String getSfxCode() {
        return sfxCode;
    }

    public void setSfxCode(String sfxCode) {
        this.sfxCode = sfxCode;
    }

    public int getSpawnCD() {
        return spawnCD;
    }

    public void setSpawnCD(int spawnCD) {
        this.spawnCD = spawnCD;
    }

    public int getIsBoss() {
        return isBoss;
    }

    public void setIsBoss(int isBoss) {
        this.isBoss = isBoss;
    }

    public int getSpawnX() {
        return spawnX;
    }

    public void setSpawnX(int spawnX) {
        this.spawnX = spawnX;
    }

    public int getSpawnY() {
        return spawnY;
    }

    public void setSpawnY(int spawnY) {
        this.spawnY = spawnY;
    }

    public String getDropItem() {
        return dropItem;
    }

    public void setDropItem(String dropItem) {
        this.dropItem = dropItem;
    }

    public List<vatPhamEntity> getDropItems() {
        return dropItems;
    }

    public void setDropItems(List<vatPhamEntity> dropItems) {
        this.dropItems = dropItems;
    }
}
